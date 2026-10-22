'use strict';
'require baseclass';
'require fs';

const HWMON_ROOT = '/sys/class/hwmon';
const THERMAL_ROOT = '/sys/class/thermal';

const SENSOR_META = {
	'mt7996_phy0.0-pci-0100': { name: _('Wi-Fi 2.4 GHz'), detail: 'MT7996', order: 20 },
	'mt7996_phy0.1-pci-0100': { name: _('Wi-Fi 5 GHz'), detail: 'MT7996', order: 21 },
	'mt7996_phy0.2-pci-0100': { name: _('Wi-Fi 6 GHz'), detail: 'MT7996', order: 22 },
	'sfp1': { name: _('SFP WAN module'), detail: 'SFP1', warning: 80, order: 30 },
	'sfp2': { name: _('SFP LAN module'), detail: 'SFP2', order: 31 },
	'i2csfp111-mdio-0': { name: _('SFP WAN PHY'), detail: 'AQR113C', warning: 95, order: 32 },
	'cpu_thermal': { name: _('CPU'), detail: 'SoC thermal', order: 10 }
};

function read(path) {
	return L.resolveDefault(fs.read(path), '');
}

function list(path) {
	return L.resolveDefault(fs.list(path), []);
}

function number(value) {
	const n = Number(String(value || '').trim());
	return Number.isFinite(n) ? n : null;
}

function temperature(value) {
	const n = number(value);

	if (n == null)
		return null;
	if (Math.abs(n) > 1000)
		return n / 1000;
	return n;
}

function sensorMeta(rawName, thermalType) {
	const key = thermalType || rawName;

	if (SENSOR_META[key])
		return SENSOR_META[key];

	if (key.indexOf('i2csfp111') === 0)
		return SENSOR_META['i2csfp111-mdio-0'];

	if (thermalType === 'cpu_thermal')
		return SENSOR_META.cpu_thermal;

	return {
		name: thermalType || rawName,
		detail: thermalType ? 'thermal zone' : rawName,
		order: 100
	};
}

function sensorState(value, warning, critical) {
	if (value == null)
		return { text: _('Temperature unavailable'), className: 'label' };
	if (critical != null && value >= critical)
		return { text: _('Temperature critical'), className: 'label danger' };
	if (warning != null && value >= warning)
		return { text: _('Temperature high'), className: 'label warning' };
	if (critical != null && value >= critical - 10)
		return { text: _('Temperature high'), className: 'label warning' };
	return { text: _('Temperature normal'), className: 'label success' };
}

function readHwmon() {
	return list(HWMON_ROOT).then(function(entries) {
		const dirs = entries
			.map(function(entry) { return entry.name; })
			.filter(function(name) { return /^hwmon\d+$/.test(name); });

		return Promise.all(dirs.map(function(dir) {
			const path = HWMON_ROOT + '/' + dir;

			return Promise.all([
				read(path + '/name'),
				read(path + '/temp1_input'),
				read(path + '/temp1_crit'),
				read(path + '/pwm1'),
				read(path + '/fan1_input')
			]).then(function(values) {
				return {
					rawName: String(values[0] || '').trim() || dir,
					temp: temperature(values[1]),
					critical: temperature(values[2]),
					pwm: number(values[3]),
					rpm: number(values[4])
				};
			});
		}));
	});
}

function readThermal() {
	return list(THERMAL_ROOT).then(function(entries) {
		const dirs = entries
			.map(function(entry) { return entry.name; })
			.filter(function(name) { return /^thermal_zone\d+$/.test(name); });

		return Promise.all(dirs.map(function(dir) {
			const path = THERMAL_ROOT + '/' + dir;

			return Promise.all([
				read(path + '/type'),
				read(path + '/temp')
			]).then(function(values) {
				return {
					rawName: dir,
					thermalType: String(values[0] || '').trim() || dir,
					temp: temperature(values[1]),
					critical: null,
					pwm: null,
					rpm: null
				};
			});
		}));
	});
}

function loadSensors() {
	return Promise.all([readHwmon(), readThermal()]).then(function(results) {
		const sensors = [];
		const seen = {};
		let fan = null;

		results[1].forEach(function(entry) {
			const meta = sensorMeta(entry.thermalType, entry.thermalType);
			const key = 'thermal:' + entry.thermalType;

			seen[key] = true;
			sensors.push({
				name: meta.name,
				detail: meta.detail,
				order: meta.order,
				temp: entry.temp,
				critical: null
			});
		});

		results[0].forEach(function(entry) {
			if (entry.rawName === 'cpu_thermal' || entry.rawName.indexOf('cpu_thermal-') === 0)
				return;

			if (entry.rawName === 'pwmfan') {
				fan = entry;
				return;
			}

			if (entry.temp == null)
				return;

			const meta = sensorMeta(entry.rawName, null);
			const key = 'hwmon:' + entry.rawName;

			if (seen[key])
				return;

			sensors.push({
				name: meta.name,
				detail: meta.detail,
				order: meta.order,
				temp: entry.temp,
				warning: meta.warning == null ? null : meta.warning,
				critical: meta.warning == null ? entry.critical : null
			});
		});

		sensors.sort(function(a, b) {
			return a.order - b.order || a.name.localeCompare(b.name);
		});

		return { sensors: sensors, fan: fan };
	});
}

function formatTemperature(value) {
	return value == null ? '-' : '%.1f °C'.format(value);
}

function metric(label, value) {
	return E('div', { 'class': 'temperature-metric' }, [
		E('span', { 'class': 'temperature-metric-label' }, label),
		E('strong', { 'class': 'temperature-metric-value' }, value)
	]);
}

function renderData(root, data) {
	const body = root.querySelector('#temperature-rows');
	const fan = root.querySelector('#fan-metrics');

	body.replaceChildren();

	if (!data.sensors.length) {
		body.appendChild(E('tr', { 'class': 'tr placeholder' }, [
			E('td', { 'class': 'td', 'colspan': '4' }, _('No temperature sensors found'))
		]));
	}
	else {
		data.sensors.forEach(function(sensor) {
			const state = sensorState(sensor.temp, sensor.warning, sensor.critical);
			const limit = sensor.warning == null ? sensor.critical : sensor.warning;

			body.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [
					E('strong', {}, sensor.name),
					E('br'),
					E('span', { 'class': 'temperature-detail' }, sensor.detail)
				]),
				E('td', { 'class': 'td temperature-reading' }, formatTemperature(sensor.temp)),
				E('td', { 'class': 'td' }, limit == null ? '-' : formatTemperature(limit)),
				E('td', { 'class': 'td' }, E('span', { 'class': state.className }, state.text))
			]));
		});
	}

	if (!data.fan) {
		fan.replaceChildren(metric(_('Fan'), _('Not detected')));
		return;
	}

	const pwm = data.fan.pwm == null ? null : Math.round(data.fan.pwm * 100 / 255);
	const metrics = [
		pwm == null ? metric(_('Fan'), _('Not detected'))
			: metric(_('Fan PWM'), '%d%%'.format(pwm))
	];

	if (data.fan.rpm != null && data.fan.rpm > 0)
		metrics.push(metric(_('Fan speed'), '%d RPM'.format(data.fan.rpm)));

	fan.replaceChildren(...metrics);
}

return baseclass.extend({
	title: _('Temperatures'),

	load() {
		return loadSensors();
	},

	render(data) {
		const root = E('div', { 'id': 'temperature-status' }, [
			E('link', {
				'rel': 'stylesheet',
				'href': L.resource('view/temperature-status.css')
			}),
			E('table', { 'class': 'table temperature-table' }, [
				E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Sensor')),
					E('th', { 'class': 'th' }, _('Temperature')),
					E('th', { 'class': 'th' }, _('Limit')),
					E('th', { 'class': 'th' }, _('Status'))
				])),
				E('tbody', { 'id': 'temperature-rows' }, E('tr', { 'class': 'tr placeholder' }, [
					E('td', { 'class': 'td', 'colspan': '4' }, _('Collecting data...'))
				]))
			]),
			E('h3', {}, _('Cooling')),
			E('div', { 'class': 'temperature-fan', 'id': 'fan-metrics' },
				metric(_('Fan'), _('Collecting data...')))
		]);

		renderData(root, data);

		return root;
	},
});
