'use strict';
'require view';
'require uci';
'require ui';
'require poll';

function endpoint(service) {
	return service.target_label + ':' + service.destination_port;
}

function collectServices() {
	return uci.sections('wan-access', 'service').map(function(section) {
		var firewallSection = section.firewall_section;
		var firewallEnabled = uci.get('firewall', firewallSection, 'enabled');
		var destIp = uci.get('firewall', firewallSection, 'dest_ip') || '';
		var targetKind = section.target_kind || 'router';
		var targetHost = section.target_host || '';

		return {
			section: section['.name'],
			title: section.title || section['.name'],
			description: section.description || '',
			firewall_section: firewallSection,
			protocol: section.protocol || 'tcp',
			wan_port: section.wan_port || '',
			destination_port: section.destination_port || '',
			target_label: targetKind === 'router' ? '路由器本机' :
				(targetHost || targetKind || '未知目标'),
			dest_ip: destIp.replace(/\/.*$/, ''),
			enabled: firewallEnabled !== '0',
			available: uci.get('firewall', firewallSection) != null
		};
	});
}

function renderRow(service, parentView) {
	var checkbox = E('input', {
		'type': 'checkbox',
		'checked': service.enabled ? '' : null,
		'disabled': service.available ? null : '',
		'aria-label': service.title,
		'change': function(ev) {
			return parentView.handleToggle(service, ev.currentTarget);
		}
	});

	return E('tr', {}, [
		E('td', {}, [
			E('strong', {}, service.title),
			service.description ? E('div', { 'class': 'cbi-value-description' }, service.description) : ''
		]),
		E('td', {}, (service.protocol || 'tcp').toUpperCase() + ' ' + service.wan_port),
		E('td', {}, endpoint(service)),
		E('td', {}, service.available ?
			E('span', { 'class': 'label ' + (service.enabled ? 'success' : 'warning') },
				service.enabled ? '已开启' : '已关闭') :
			E('span', { 'class': 'label danger' }, '规则缺失')),
		E('td', { 'class': 'center' }, checkbox)
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('wan-access'),
			uci.load('firewall')
		]);
	},

	render: function() {
		this.data = { services: collectServices() };
		this.rowsNode = E('tbody');
		this.tableNode = E('div', { 'class': 'table-wrapper' },
			E('table', { 'class': 'table' }, [
				E('thead', {}, E('tr', {}, [
					E('th', {}, '服务'),
					E('th', {}, '外网入口'),
					E('th', {}, '目标'),
					E('th', {}, '状态'),
					E('th', { 'class': 'center' }, '开关')
				])),
				this.rowsNode
			]));
		this.renderTable();

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, '外网访问控制'),
			E('div', { 'class': 'cbi-section' }, this.tableNode)
		]);
	},

	renderTable: function() {
		var services = (this.data && this.data.services) || [];
		this.rowsNode.replaceChildren.apply(this.rowsNode, services.map(function(service) {
			return renderRow(service, this);
		}, this));
	},

	handleToggle: function(service, input) {
		var enabled = input.checked ? '1' : '0';
		input.disabled = true;

		uci.set('wan-access', service.section, 'enabled', enabled);
		uci.set('firewall', service.firewall_section, 'enabled', enabled);

		return uci.save().then(function() {
			return uci.apply(10);
		}).then(L.bind(function() {
			this.data = { services: collectServices() };
			this.renderTable();
			ui.addNotification(null, E('p', {}, enabled === '1' ? '外网访问已开启。' : '外网访问已关闭。'), 'info');
		}, this)).catch(function(error) {
			input.checked = !input.checked;
			input.disabled = false;
			ui.addNotification(null, E('p', {}, error.message || String(error)), 'danger');
		});
	}
});
