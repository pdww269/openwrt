'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require view.mtk_soc.ui as aui';

var callStatus = rpc.declare({ object: 'luci.mtk_soc', method: 'getStatus', expect: {} });
var callPorts = rpc.declare({ object: 'luci.mtk_soc', method: 'getPorts', expect: {} });
var callPpeEntries = rpc.declare({ object: 'luci.mtk_soc', method: 'getPpeEntries', expect: {} });
var callSetCpu = rpc.declare({
	object: 'luci.mtk_soc',
	method: 'setCpuSettings',
	params: [ 'governor', 'max_freq' ],
	expect: {}
});

var LOAD_KEY = 'mtk-soc.load-history.v1';
var BASE_KEY = 'mtk-soc.load-baseline.v1';
var FREQ_KEY = 'mtk-soc.freq-history.v1';
var MAX_SAMPLES = 120;
var HISTORY_AGE = 30 * 60 * 1000;

var GOVERNOR_LABELS = {
	conservative: '保守模式',
	ondemand: '按需模式',
	userspace: '用户空间',
	powersave: '省电模式',
	performance: '性能模式',
	schedutil: '调度模式'
};

var DUPLEX_LABELS = {
	full: '全双工',
	half: '半双工',
	unknown: '未知'
};

function fmtMHz(khz) {
	return (khz == null || khz < 0) ? 'N/A' : Math.round(khz / 1000) + ' MHz';
}

function fmtHz(hz) {
	if (hz == null || hz < 0)
		return 'N/A';
	if (hz >= 1000000000)
		return (hz / 1000000000).toFixed(2).replace(/\.?0+$/, '') + ' GHz';
	return Math.round(hz / 1000000) + ' MHz';
}

function fmtTemp(mc) {
	return (mc == null || mc < 0) ? 'N/A' : (mc / 1000).toFixed(1) + ' °C';
}

function fmtNumber(v) {
	return (v == null || v < 0) ? 'N/A' : String(v);
}

function fmtBytes(v) {
	if (v == null || v < 0)
		return 'N/A';
	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], n = Number(v), i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return (i ? n.toFixed(1) : String(n)) + ' ' + units[i];
}

function fmtRate(v) {
	return (v == null || v < 0) ? 'N/A' : (v / 1000).toFixed(1) + 'k';
}

function governorLabel(v) {
	return GOVERNOR_LABELS[v] ? _(GOVERNOR_LABELS[v]) : (v || '-');
}

function duplexLabel(v) {
	return DUPLEX_LABELS[v] ? _(DUPLEX_LABELS[v]) : (v || _('未知'));
}

function fmtClock(t) {
	var d = new Date(t);
	function p(n) { return (n < 10 ? '0' : '') + n; }
	return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function fmtUptime(sec) {
	if (sec == null || sec < 0)
		return 'N/A';
	var d = Math.floor(sec / 86400);
	var h = Math.floor(sec % 86400 / 3600);
	var m = Math.floor(sec % 3600 / 60);
	var parts = [];
	if (d)
		parts.push(d + ' ' + _('天'));
	if (d || h)
		parts.push(h + ' ' + _('小时'));
	parts.push(m + ' ' + _('分'));
	return parts.join(' ');
}

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td' }, label),
		E('td', { 'class': 'td' }, value)
	]);
}

function card(title, body, hint, count, countId) {
	return aui.section({
		title: title,
		hint: hint,
		count: count,
		countId: countId,
		body: body
	});
}

function cpuCell(id, title, body, accent) {
	return E('div', { 'class': 'mtk-soc-cpu-cell ' + (accent || 'mtk-accent-blue'), id: id }, [
		E('h4', {}, title),
		body
	]);
}

function serviceBadge(up) {
	return E('span', { 'class': up ? 'label success' : 'label warning' }, up ? _('已连接') : _('未连接'));
}

function loadStored(key, fallback) {
	try {
		var value = JSON.parse(sessionStorage.getItem(key) || 'null');
		return value == null ? fallback : value;
	} catch (e) {
		return fallback;
	}
}

function saveStored(key, value) {
	try {
		sessionStorage.setItem(key, JSON.stringify(value));
	} catch (e) {}
}

var loadHistory = loadStored(LOAD_KEY, []).filter(function(s) {
	return s && typeof s.t === 'number' && Array.isArray(s.u);
}).slice(-MAX_SAMPLES);

var loadBaseline = loadStored(BASE_KEY, null);
var freqHistory = loadStored(FREQ_KEY, []).filter(function(s) {
	return s && typeof s.t === 'number' && typeof s.f === 'number';
}).slice(-MAX_SAMPLES);
var ppeCurrentEntries = [];
var ppeStateFilter = '';
var ppeEngineFilter = '';
var ppeTypeFilter = '';
var ppePage = 0;
var PPE_PAGE_SIZE = 50;
var PPE_STATES = [ 'BND', 'UNB', 'FIN' ];
var PPE_ENGINES = [ 'ppe0', 'ppe1', 'ppe2' ];

function mergeFixed(fixed, dynamic) {
	var out = fixed.slice();
	(dynamic || []).forEach(function(item) {
		if (item && out.indexOf(item) < 0)
			out.push(item);
	});
	return out.sort();
}

function pushLoad(ticks) {
	if (!Array.isArray(ticks) || !ticks.length)
		return;

	var current = ticks.map(function(t) { return [ Number(t.total), Number(t.idle) ]; });
	var now = Date.now();
	if (loadBaseline && Array.isArray(loadBaseline.ticks) && loadBaseline.ticks.length === current.length) {
		var usage = [], measured = false;
		for (var i = 0; i < current.length; i++) {
			var dt = current[i][0] - loadBaseline.ticks[i][0];
			var di = current[i][1] - loadBaseline.ticks[i][1];
			if (dt > 0 && di >= 0 && di <= dt) {
				usage.push(Math.round((1 - di / dt) * 1000) / 10);
				measured = true;
			} else {
				usage.push(null);
			}
		}
		if (measured) {
			loadHistory.push({ t: now, u: usage });
			loadHistory = loadHistory.filter(function(s) { return s.t >= now - HISTORY_AGE; }).slice(-MAX_SAMPLES);
			saveStored(LOAD_KEY, loadHistory);
		}
	}
	loadBaseline = { t: now, ticks: current };
	saveStored(BASE_KEY, loadBaseline);
}

function pushFreq(khz) {
	var f = Number(khz);
	if (!isFinite(f) || f <= 0)
		return;

	var now = Date.now();
	var last = freqHistory[freqHistory.length - 1];
	if (last && (now - last.t) < 1500)
		return;

	freqHistory.push({ t: now, f: f });
	freqHistory = freqHistory.filter(function(s) { return s.t >= now - HISTORY_AGE; }).slice(-MAX_SAMPLES);
	saveStored(FREQ_KEY, freqHistory);
}

function svgEl(tag, attrs, children) {
	var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	Object.keys(attrs || {}).forEach(function(key) {
		if (attrs[key] == null)
			return;
		node.setAttribute(key, attrs[key]);
	});
	(children || []).forEach(function(child) {
		node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	});
	return node;
}

function lineChart(opts) {
	var samples = opts.samples || [];
	var min = opts.min, max = opts.max;
	var count = samples.length;
	var W = 1000, H = 320;
	var nodes = [];

	function x(i) { return count <= 1 ? 0 : i / (count - 1) * W; }
	function y(v) { return H - (Math.max(min, Math.min(max, v)) - min) / (max - min) * H; }

	(opts.grid || []).forEach(function(g) {
		nodes.push(svgEl('line', {
			x1: 0, y1: y(g).toFixed(1), x2: W, y2: y(g).toFixed(1),
			stroke: 'currentColor', 'stroke-opacity': '.15',
			'stroke-dasharray': '3 5', 'vector-effect': 'non-scaling-stroke'
		}));
	});

	(opts.marks || []).forEach(function(mark) {
		nodes.push(svgEl('line', {
			x1: 0, y1: y(mark.value).toFixed(1), x2: W, y2: y(mark.value).toFixed(1),
			stroke: mark.color, 'stroke-width': 1.3,
			'stroke-dasharray': '7 6', 'vector-effect': 'non-scaling-stroke'
		}));
	});

	(opts.series || []).forEach(function(line) {
		var points = '';
		line.values.forEach(function(v, i) {
			if (v == null)
				return;
			points += (points ? ' ' : '') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
		});
		if (points)
			nodes.push(svgEl('polyline', {
				points: points, fill: 'none', stroke: line.color, 'stroke-width': 2,
				'stroke-linejoin': 'round', 'stroke-linecap': 'round',
				'vector-effect': 'non-scaling-stroke'
			}));
	});

	return svgEl('svg', {
		viewBox: '0 0 ' + W + ' ' + H,
		preserveAspectRatio: 'none',
		width: '100%',
		height: '100%',
		style: 'display:block;color:var(--text-color-medium,#8a8f98)',
		role: 'img'
	}, nodes);
}

function chartBox(opts) {
	var plot = E('div', { 'class': 'mtk-chart-plot' });
	plot.appendChild(lineChart(opts));

	var labels = (opts.yLabels || []).map(function(item) {
		var top = (opts.max - item.v) / (opts.max - opts.min) * 100;
		return E('span', { style: 'top:' + top.toFixed(2) + '%' }, item.text);
	});
	if (labels.length)
		plot.appendChild(E('div', { 'class': 'mtk-chart-yaxis' }, labels));

	if (opts.tooltip) {
		var vline = E('div', { 'class': 'mtk-chart-vline' });
		var tip = E('div', { 'class': 'mtk-chart-tip' });
		plot.appendChild(vline);
		plot.appendChild(tip);
		plot.addEventListener('mousemove', function(ev) {
			var count = (opts.samples || []).length;
			if (count < 1)
				return;
			var rect = plot.getBoundingClientRect();
			if (!rect.width)
				return;
			var ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
			var index = Math.round(ratio * (count - 1));
			var leftPct = count <= 1 ? 0 : index / (count - 1) * 100;
			vline.style.display = 'block';
			vline.style.left = leftPct + '%';
			tip.replaceChildren.apply(tip, opts.tooltip(index));
			tip.style.display = 'block';
			tip.style.left = Math.min(88, Math.max(12, leftPct)) + '%';
		});
		plot.addEventListener('mouseleave', function() {
			vline.style.display = 'none';
			tip.style.display = 'none';
		});
	}

	var kids = [];
	if (opts.legend && opts.legend.length)
		kids.push(E('div', { 'class': 'mtk-chart-legend' }, opts.legend));
	kids.push(plot);
	return E('div', { 'class': 'mtk-chart' }, kids);
}

function renderCpuInfoTable(s) {
	return E('table', { 'class': 'table mtk-kv' }, E('tbody', {}, [
		row(_('型号'), s.cpu_model || '-'),
		row(_('核心数量'), fmtNumber(s.cpu_count)),
		row(_('设备名称'), s.hostname || '-'),
		row(_('运行时间'), fmtUptime(s.uptime))
	]));
}

function renderCpuControlsBody(s, onApply) {
	var governor = E('select', { id: 'mtk-cpu-governor', class: 'cbi-input-select' },
		(s.cpu_available_governors || []).map(function(g) {
			return E('option', { value: g, selected: g == s.cpu_governor ? '' : null }, governorLabel(g));
		}));
	var maxFreq = E('select', { id: 'mtk-cpu-maxfreq', class: 'cbi-input-select' },
		(s.cpu_available_freqs || []).map(function(f) {
			return E('option', { value: f, selected: Number(f) == Number(s.cpu_max_freq) ? '' : null }, fmtMHz(Number(f)));
		}));
	var button = E('button', { class: 'btn cbi-button cbi-button-apply', click: function() {
		return onApply(governor.value, maxFreq.value);
	}}, _('保存'));

	return E('div', { 'class': 'mtk-cpu-control' }, [
		E('div', { 'class': 'mtk-cpu-facts' }, [
			E('span', {}, _('架构')), E('strong', {}, s.cpu_arch || '-'),
			E('span', {}, _('当前频率')), E('strong', {}, fmtMHz(s.cpu_cur_freq)),
			E('span', {}, _('频率范围')), E('strong', {}, fmtMHz(s.cpu_min_freq) + ' / ' + fmtMHz(s.cpu_max_freq))
		]),
		E('div', { 'class': 'mtk-cpu-form' }, [
			E('label', { 'class': 'mtk-field' }, [ E('span', {}, _('运行模式')), governor ]),
			E('label', { 'class': 'mtk-field' }, [ E('span', {}, _('最大频率')), maxFreq ]),
			E('div', { 'class': 'mtk-field-actions' }, [ button ])
		])
	]);
}

function portSpeed(p) {
	if (!p.up || Number(p.speed_mbps) <= 0)
		return 'N/A';
	return p.speed_mbps + ' Mbps / ' + duplexLabel(p.duplex);
}

function renderPorts(ports) {
	var rows = (ports.ports || []).map(function(p) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, E('strong', {}, p.name)),
			E('td', { 'class': 'td' }, p.path || '-'),
			E('td', { 'class': 'td' }, serviceBadge(!!p.up)),
			E('td', { 'class': 'td' }, portSpeed(p)),
			E('td', { 'class': 'td' }, fmtBytes(p.rx_bytes) + ' / ' + fmtBytes(p.tx_bytes)),
			E('td', { 'class': 'td' }, fmtRate(p.rx_packets) + ' / ' + fmtRate(p.tx_packets)),
			E('td', { 'class': 'td' }, fmtNumber(p.rx_errors) + ' / ' + fmtNumber(p.tx_errors)),
			E('td', { 'class': 'td' }, fmtNumber(p.rx_dropped) + ' / ' + fmtNumber(p.tx_dropped))
		]);
	});

	return card(_('以太网端口'), E('div', { style: 'overflow-x:auto' },
		E('table', { 'class': 'table' }, [
			E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('端口')),
				E('th', { 'class': 'th' }, _('路径')),
				E('th', { 'class': 'th' }, _('连接状态')),
				E('th', { 'class': 'th' }, _('速率 / 双工')),
				E('th', { 'class': 'th' }, _('接收 / 发送字节')),
				E('th', { 'class': 'th' }, _('接收 / 发送包数')),
				E('th', { 'class': 'th' }, _('接收 / 发送错误')),
				E('th', { 'class': 'th' }, _('接收 / 发送丢包'))
			])),
			E('tbody', {}, rows)
		])
	));
}

function tempLevel(current, warn, crit) {
	if (current == null || current < 0)
		return { text: _('未知'), cls: 'label' };
	if (crit >= 0 && current >= crit)
		return { text: _('临界'), cls: 'label danger' };
	if (warn >= 0 && current >= warn)
		return { text: _('警告'), cls: 'label warning' };
	return { text: _('正常'), cls: 'label success' };
}

function tempLimit(warn, crit) {
	var w = (warn == null || warn < 0) ? null : fmtTemp(warn);
	var c = (crit == null || crit < 0) ? null : fmtTemp(crit);
	if (!w && !c)
		return 'N/A';
	return (w || 'N/A') + ' / ' + (c || 'N/A');
}

function renderThermal(s) {
	function tempRow(name, cur, warn, crit, alarm) {
		var st = tempLevel(cur, warn, crit);
		if (alarm > 0 && st.cls === 'label success')
			st = { text: _('告警'), cls: 'label warning' };
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, name),
			E('td', { 'class': 'td' }, fmtTemp(cur)),
			E('td', { 'class': 'td' }, tempLimit(warn, crit)),
			E('td', { 'class': 'td' }, E('span', { 'class': st.cls }, st.text))
		]);
	}

	var fanOn = s.fan_pwm >= 0;
	return card(_('温度 / 风扇'), E('table', { 'class': 'table' }, [
		E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('传感器')),
			E('th', { 'class': 'th' }, _('当前')),
			E('th', { 'class': 'th' }, _('限制 (警告 / 临界)')),
			E('th', { 'class': 'th' }, _('状态'))
		])),
		E('tbody', {}, [
			tempRow(_('CPU'), s.cpu_temp_mc, s.cpu_temp_warn_mc, s.cpu_temp_crit_mc, -1),
			tempRow(_('SFP WAN'), s.sfp1_temp_mc, s.sfp1_temp_max_mc, s.sfp1_temp_crit_mc, s.sfp1_temp_alarm),
			tempRow(_('SFP LAN'), s.sfp2_temp_mc, s.sfp2_temp_max_mc, s.sfp2_temp_crit_mc, s.sfp2_temp_alarm),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, _('风扇 PWM')),
				E('td', { 'class': 'td' }, fanOn ? s.fan_pwm + ' / 255' : 'N/A'),
				E('td', { 'class': 'td' }, '-'),
				E('td', { 'class': 'td' }, E('span', { 'class': fanOn ? 'label success' : 'label' }, fanOn ? _('运行中') : _('未知')))
			])
		])
	]));
}

function renderNpuTiles(s) {
	var ppe = s.ppe || {};
	var total = 0, bound = 0;
	[ 'ppe0', 'ppe1', 'ppe2' ].forEach(function(name) {
		total += Number(ppe[name] && ppe[name].total || 0);
		bound += Number(ppe[name] && ppe[name].bound || 0);
	});
	var active = total > 0 || bound > 0;

	function tile(title, value, sub, accent) {
		return aui.tile({ title: title, value: value, sub: sub, accent: accent });
	}

	return card(_('NPU / 卸载总览'), E('div', { 'class': 'ai-grid ai-grid--tiles' }, [
		tile(_('NPU 状态'), active ? _('已激活') : _('未激活'), 'MT7988 PPE', active ? 'var(--ds-ok)' : null),
		tile(_('NPU 时钟 / 引擎'), fmtHz(s.clocks && s.clocks.npu_tops), _('3 个 PPE 引擎表'), 'var(--ds-ok)'),
		tile(_('卸载统计'), bound + ' / ' + total, _('已绑定 / PPE 总表项'), 'var(--ai-npu)'),
		tile(_('CPU 温度'), fmtTemp(s.cpu_temp_mc), fmtNumber(s.cpu_count) + ' 核 · ' + (s.compatible || ''), 'var(--ds-ok)')
	]));
}

function renderPpeEngines(s) {
	var ppe = s.ppe || {};
	var cards = [];
	[ 'ppe0', 'ppe1', 'ppe2' ].forEach(function(name) {
		var p = ppe[name] || {};
		cards.push(aui.card({
			name: name.toUpperCase(),
			accent: 'var(--ai-npu)',
			body: E('table', { 'class': 'table mtk-kv' }, E('tbody', {}, [
				row(_('总'), fmtNumber(p.total)),
				row(_('已绑定'), fmtNumber(p.bound)),
				row(_('未绑定'), fmtNumber(p.unbound)),
				row(_('字节'), fmtBytes(p.bytes))
			]))
		}));
	});
	return card(_('PPE 引擎'), E('div', { 'class': 'ai-grid ai-grid--3' }, cards));
}

function ppeEntryRow(e) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td' }, e.engine || '-'),
		E('td', { 'class': 'td' }, e.index || '-'),
		E('td', { 'class': 'td' }, E('span', { 'class': e.state === 'BND' ? 'label success' : 'label' }, e.state || '-')),
		E('td', { 'class': 'td' }, e.type || '-'),
		E('td', { 'class': 'td' }, e.orig || '-'),
		E('td', { 'class': 'td' }, e.new_flow || '-'),
		E('td', { 'class': 'td' }, e.eth || '-'),
		E('td', { 'class': 'td' }, e.vlan || '-'),
		E('td', { 'class': 'td' }, fmtNumber(e.packets)),
		E('td', { 'class': 'td' }, fmtBytes(e.bytes))
	]);
}

function ppeType(e) {
	return String(e.type || '').split(' ').slice(0, 2).join(' ');
}

function ppeFilteredEntries() {
	return ppeCurrentEntries.filter(function(e) {
		return (!ppeStateFilter || e.state === ppeStateFilter) &&
			(!ppeEngineFilter || e.engine === ppeEngineFilter) &&
			(!ppeTypeFilter || ppeType(e) === ppeTypeFilter);
	});
}

function rerenderPpeTables() {
	var host = document.getElementById('mtk-soc-tables');
	if (host)
		host.replaceChildren(renderPpeEntries(null));
}

function ppeSelect(label, value, values, setter) {
	var field = E('label', { style: 'display:flex;flex-direction:column;gap:.2rem;font-size:.85em' });
	var select = E('select', {
		class: 'cbi-input-select',
		change: function(ev) {
			setter(ev.target.value);
			ppePage = 0;
			rerenderPpeTables();
		}
	});

	field.appendChild(E('span', {}, label));
	select.appendChild(E('option', { value: '' }, _('全部')));
	(values || []).forEach(function(item) {
		select.appendChild(E('option', { value: item }, String(item)));
	});
	select.value = value || '';
	field.appendChild(select);
	return field;
}

function renderPpeEntries(data) {
	if (data)
		ppeCurrentEntries = (data.entries || []).slice();

	var states = mergeFixed(PPE_STATES, Array.from(new Set(ppeCurrentEntries.map(function(e) { return e.state; }).filter(Boolean))));
	var engines = mergeFixed(PPE_ENGINES, Array.from(new Set(ppeCurrentEntries.map(function(e) { return e.engine; }).filter(Boolean))));
	var types = Array.from(new Set(ppeCurrentEntries.map(ppeType).filter(Boolean))).sort();
	var filtered = ppeFilteredEntries();
	var pages = Math.max(1, Math.ceil(filtered.length / PPE_PAGE_SIZE));
	ppePage = Math.max(0, Math.min(ppePage, pages - 1));
	var rows = filtered.slice(ppePage * PPE_PAGE_SIZE, (ppePage + 1) * PPE_PAGE_SIZE);

	var toolbar = E('div', { style: 'display:flex;gap:.65rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:.65rem' }, [
		ppeSelect(_('状态'), ppeStateFilter, states, function(v) { ppeStateFilter = v; }),
		ppeSelect(_('引擎'), ppeEngineFilter, engines, function(v) { ppeEngineFilter = v; }),
		ppeSelect(_('类型'), ppeTypeFilter, types, function(v) { ppeTypeFilter = v; }),
		E('span', { style: 'margin-left:auto;opacity:.7;font-size:.85em' },
			filtered.length + ' / ' + ppeCurrentEntries.length + ' ' + _('条表项')),
		E('button', {
			class: 'btn cbi-button',
			disabled: ppePage <= 0 ? '' : null,
			click: function() { ppePage = Math.max(0, ppePage - 1); rerenderPpeTables(); }
		}, '\u2039'),
		E('span', { style: 'min-width:5em;text-align:center' }, (ppePage + 1) + ' / ' + pages),
		E('button', {
			class: 'btn cbi-button',
			disabled: ppePage + 1 >= pages ? '' : null,
			click: function() { ppePage = Math.min(pages - 1, ppePage + 1); rerenderPpeTables(); }
		}, '\u203a')
	]);

	return card(_('PPE 流卸载表'), E('div', {}, [
		toolbar,
		E('div', { style: 'overflow-x:auto' },
			E('div', { style: 'max-height:32rem;overflow:auto' }, E('table', { 'class': 'table' }, [
				E('thead', {}, E('tr', { 'class': 'tr table-titles' }, [
					E('th', {}, _('引擎')), E('th', {}, _('索引')), E('th', {}, _('状态')),
					E('th', {}, _('类型')), E('th', {}, _('原始连接')), E('th', {}, _('新连接')),
					E('th', {}, _('以太网')), E('th', {}, 'VLAN'), E('th', {}, _('数据包')), E('th', {}, _('字节'))
				])),
				E('tbody', {}, rows.length ? rows.map(ppeEntryRow) :
					E('tr', { 'class': 'tr' }, E('td', { 'class': 'td', colspan: 10 }, _('暂无 PPE 表项'))))
			]))
		)
	]), null, filtered.length + ' / ' + ppeCurrentEntries.length, 'mtk-ppe-count');
}

function renderUsageChart() {
	var loadSamples = loadHistory;
	var coreCount = loadSamples.reduce(function(n, s) { return Math.max(n, s.u.length); }, 0);
	var colors = [ '#1663d6', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#f08c00', '#5f3dc4' ];
	var series = [], legend = [];

	for (var c = 0; c < coreCount; c++) {
		var color = colors[c % colors.length];
		var values = loadSamples.map(function(sample) { return sample.u[c] == null ? null : sample.u[c]; });
		series.push({ color: color, values: values });

		var latest = null;
		for (var i = values.length - 1; i >= 0; i--) {
			if (values[i] != null) { latest = values[i]; break; }
		}
		legend.push(E('span', {}, [
			E('i', { style: 'background:' + color }),
			'cpu' + c + ' ' + (latest == null ? '-' : latest.toFixed(1) + '%')
		]));
	}

	return chartBox({
		samples: loadSamples,
		min: 0,
		max: 100,
		grid: [ 0, 50, 100 ],
		yLabels: [ { v: 0, text: '0%' }, { v: 50, text: '50%' }, { v: 100, text: '100%' } ],
		series: series,
		legend: legend,
		tooltip: function(index) {
			var sample = loadSamples[index];
			if (!sample)
				return [];
			var out = [ E('b', {}, fmtClock(sample.t)) ];
			for (var c = 0; c < sample.u.length; c++)
				out.push(E('div', {}, 'cpu' + c + ' ' + (sample.u[c] == null ? '-' : sample.u[c].toFixed(1) + '%')));
			return out;
		}
	});
}

function renderFreqChart(s) {
	var avail = (s.cpu_available_freqs || []).map(Number).filter(function(v) { return v > 0; });
	var minF = avail.length ? Math.min.apply(null, avail) / 1000 : 800;
	var maxF = avail.length ? Math.max.apply(null, avail) / 1000 : 1800;
	var limit = Number(s.cpu_max_freq) / 1000;
	var current = Number(s.cpu_cur_freq) / 1000;
	var lineColor = '#4dabf7', limitColor = '#e8590c';
	var marks = [], legend = [];

	if (isFinite(limit) && limit >= minF && limit <= maxF) {
		marks.push({ value: limit, color: limitColor });
		legend.push(E('span', {}, [
			E('i', { style: 'background:' + limitColor }),
			_('上限') + ' ' + Math.round(limit) + ' MHz'
		]));
	}
	legend.unshift(E('span', {}, [
		E('i', { style: 'background:' + lineColor }),
		_('当前') + ' ' + (isFinite(current) ? Math.round(current) + ' MHz' : '-')
	]));

	var midF = (minF + maxF) / 2;
	return chartBox({
		samples: freqHistory,
		min: minF,
		max: maxF,
		grid: [ minF, midF, maxF ],
		yLabels: [
			{ v: minF, text: Math.round(minF) + ' MHz' },
			{ v: midF, text: Math.round(midF) + ' MHz' },
			{ v: maxF, text: Math.round(maxF) + ' MHz' }
		],
		marks: marks,
		series: [ { color: lineColor, values: freqHistory.map(function(sample) { return sample.f / 1000; }) } ],
		legend: legend,
		tooltip: function(index) {
			var sample = freqHistory[index];
			if (!sample)
				return [];
			return [ E('b', {}, fmtClock(sample.t)), E('div', {}, Math.round(sample.f / 1000) + ' MHz') ];
		}
	});
}

function applyStatus(refs, status, ports, entries) {
	pushLoad(status.cpu_ticks);
	pushFreq(status.cpu_cur_freq);

	refs.ports.replaceChildren(renderPorts(ports));
	refs.cpuInfo.replaceChildren(renderCpuInfoTable(status));
	refs.cpuUsage.replaceChildren(renderUsageChart());
	refs.cpuFreq.replaceChildren(renderFreqChart(status));
	refs.npu.replaceChildren(renderNpuTiles(status));
	refs.engines.replaceChildren(renderPpeEngines(status));
	refs.thermal.replaceChildren(renderThermal(status));
	refs.tables.replaceChildren(renderPpeEntries(entries));
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callPorts(), callPpeEntries() ]);
	},

	render: function(data) {
		var status = data[0] || {};
		var ports = data[1] || {};
		var entries = data[2] || {};
		aui.ensureCss();
		var pageCss = [
			'.mtk-soc-page .table td,.mtk-soc-page .table th{padding:.32rem .45rem}',
			'.mtk-soc-page .table{margin:0}',
			'.mtk-soc-cpu-grid{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;grid-template-rows:minmax(160px,auto) minmax(297px,auto)}',
			'.mtk-soc-cpu-cell{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;font-size:12.5px;',
			'border:1px solid rgba(127,127,127,.22);border-radius:8px;background:rgba(127,127,127,.06);padding:.6rem .75rem .65rem 1rem}',
			'.mtk-soc-cpu-cell::before{content:"";position:absolute;left:0;top:.45rem;bottom:.45rem;width:3px;border-radius:0 3px 3px 0;background:var(--mtk-accent,#4dabf7)}',
			'.mtk-soc-cpu-cell.mtk-accent-blue{--mtk-accent:#4dabf7}',
			'.mtk-soc-cpu-cell.mtk-accent-green{--mtk-accent:#2f9e44}',
			'.mtk-soc-cpu-cell.mtk-accent-orange{--mtk-accent:#e8590c}',
			'.mtk-soc-cpu-cell>h4{margin:0 0 .5rem;font-size:.95rem;font-weight:600}',
			'.mtk-soc-cpu-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
			'.mtk-soc-page .mtk-soc-cpu-cell .mtk-kv{font-size:inherit}',
			'.mtk-soc-page .mtk-soc-cpu-cell .mtk-kv td{font-size:1em}',
			'.mtk-kv td:first-child{opacity:.72}',
			'.mtk-kv td:last-child{font-weight:600;text-align:right}',
			'.mtk-cpu-facts{display:grid;grid-template-columns:auto 1fr;gap:.3rem .8rem;margin:0 0 .7rem;font-size:1em}',
			'.mtk-cpu-facts>span{opacity:.72}',
			'.mtk-cpu-facts>strong{font-weight:600;text-align:right}',
			'.mtk-cpu-form{display:flex;flex-wrap:wrap;gap:.55rem .9rem;align-items:center}',
			'.mtk-field{display:flex;align-items:center;gap:.5rem;margin:0}',
			'.mtk-field>span{opacity:.85;white-space:nowrap}',
			'.mtk-field select{min-width:9.5rem}',
			'.mtk-chart{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
			'.mtk-chart-legend{display:flex;flex-wrap:wrap;gap:.25rem .85rem;margin-bottom:.35rem;font-size:.82em;opacity:.9}',
			'.mtk-chart-legend i{display:inline-block;width:.85em;height:2px;border-radius:2px;vertical-align:.2em;margin-right:.35em}',
			'.mtk-chart-plot{position:relative;flex:1 1 auto;min-height:0}',
			'.mtk-chart-plot>svg{position:absolute;inset:0;width:100%;height:100%}',
			'.mtk-chart-yaxis{position:absolute;inset:0;pointer-events:none;font-size:.72em;opacity:.7}',
			'.mtk-chart-yaxis>span{position:absolute;left:2px;transform:translateY(-50%)}',
			'.mtk-chart-vline{position:absolute;top:0;bottom:0;width:1px;background:rgba(127,127,127,.55);display:none;pointer-events:none}',
			'.mtk-chart-tip{position:absolute;top:.3rem;transform:translateX(-50%);display:none;pointer-events:none;z-index:3;',
			'background:rgba(15,18,24,.94);border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:.25rem .5rem;',
			'font-size:.78em;line-height:1.5;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.35)}',
			'.mtk-chart-tip b{font-weight:600}'
		].join('');
		var refs = {
			ports: E('div', { id: 'mtk-soc-ports' }),
			cpuInfo: E('div', { 'class': 'mtk-soc-cpu-body' }),
			cpuControl: E('div', { 'class': 'mtk-soc-cpu-body' }),
			cpuUsage: E('div', { 'class': 'mtk-soc-cpu-body' }),
			cpuFreq: E('div', { 'class': 'mtk-soc-cpu-body' }),
			npu: E('div', { id: 'mtk-soc-npu' }),
			engines: E('div', { id: 'mtk-soc-engines' }),
			thermal: E('div', { id: 'mtk-soc-thermal' }),
			tables: E('div', { id: 'mtk-soc-tables' })
		};
		var cpuBlock = aui.section({
			title: _('CPU'),
			body: E('div', { 'class': 'mtk-soc-cpu-grid' }, [
				cpuCell('mtk-soc-cpu-info', _('CPU 信息'), refs.cpuInfo, 'mtk-accent-blue'),
				cpuCell('mtk-soc-cpu-control', _('CPU 控制'), refs.cpuControl, 'mtk-accent-green'),
				cpuCell('mtk-soc-cpu-usage', _('CPU 占用率历史'), refs.cpuUsage, 'mtk-accent-orange'),
				cpuCell('mtk-soc-cpu-freq', _('CPU 频率历史'), refs.cpuFreq, 'mtk-accent-blue')
			])
		});
		var root = E('div', { 'class': 'cbi-map airoha-page' }, [
			E('style', {}, pageCss),
			E('h2', {}, _('MediaTek SoC 状态')),
			E('div', { 'class': 'mtk-soc-page', id: 'mtk-soc-body', style: 'margin-top:.5rem' }, [
				refs.ports,
				cpuBlock,
				refs.npu,
				refs.engines,
				refs.thermal,
				refs.tables
			])
		]);

		refs.cpuControl.appendChild(renderCpuControlsBody(status, function(governor, maxFreq) {
			return callSetCpu(governor, maxFreq).then(function() {
				ui.addNotification(null, E('p', {}, _('CPU 设置已应用')), 'info');
				return callStatus().then(function(s) {
					applyStatus(refs, s || {}, ports, entries);
				});
			});
		}));

		applyStatus(refs, status, ports, entries);

		poll.add(L.bind(function() {
			return Promise.all([ callStatus(), callPorts(), callPpeEntries() ]).then(function(next) {
				applyStatus(refs, next[0] || {}, next[1] || {}, next[2] || {});
			});
		}, this), 5);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
