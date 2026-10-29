'use strict';
'require view';
'require rpc';
'require ui';
'require uci';
'require poll';

var callInterfaces = rpc.declare({
	object: 'luci.pppoe_diagnostics',
	method: 'getInterfaces',
	expect: { interface: [] }
});

var callStatus = rpc.declare({
	object: 'luci.pppoe_diagnostics',
	method: 'getStatus',
	params: [ 'name' ],
	expect: {}
});

var callLogs = rpc.declare({
	object: 'luci.pppoe_diagnostics',
	method: 'getLogs',
	expect: { text: '', lines: 0 }
});

function ensureStylesheet() {
	if (document.querySelector('link[data-pppoe-diagnostics-style]'))
		return;

	document.head.appendChild(E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('view/network/pppoe-diagnostics.css') + '?v=8',
		'data-pppoe-diagnostics-style': '1'
	}));
}

function asArray(value) {
	if (Array.isArray(value))
		return value;

	return value == null || value === '' ? [] : [ value ];
}

function classifyLine(line) {
	if (/(error|fail|timeout|timed out|terminated|hangup|nack|denied|unavailable|no response|disconnect|not found|unable|abort|dropped)/i.test(line))
		return 'error';

	if (/(success|connected|authorized|now up|local\s+IP address|authentication succeeded|PPP session|link is up|entered forwarding)/i.test(line))
		return 'success';

	if (/(netifd|interface .+|link is down|entered disabled|setting up now|pending)/i.test(line))
		return 'state';

	return 'info';
}

function describeFailure(line) {
	var text = String(line || '');
	var match;

	if (/Timeout waiting for PADO packets/i.test(text))
		return 'PPPoE 发现超时：未收到 PADO，上游未应答或 VLAN/桥接不匹配';

	if (/Timeout waiting for PADS packets/i.test(text))
		return 'PPPoE 会话建立超时：收到 PADO 但未收到 PADS';

	if (/Unable to complete PPPoE Discovery phase 1/i.test(text))
		return 'PPPoE Discovery 第一阶段失败';

	if (/CHAP authentication failed/i.test(text))
		return 'CHAP 认证失败：账号或密码不被上游接受';

	if (/PAP authentication failed/i.test(text))
		return 'PAP 认证失败：账号或密码不被上游接受';

	if (/Authentication failed/i.test(text))
		return 'PPPoE 认证失败';

	if ((match = text.match(/No response to (\d+) echo-requests/i)))
		return 'PPP 心跳超时：连续 ' + match[1] + ' 次 LCP Echo 无响应';

	if (/Modem hangup/i.test(text))
		return '上游 PPP 链路挂断';

	if (/Connection terminated/i.test(text))
		return 'PPPoE 连接被终止';

	if (/Interface .+ is now down/i.test(text))
		return 'netifd 将接口判定为断开';

	if (/Link is Down|link is down|entered disabled/i.test(text))
		return '上游以太网链路断开';

	if (/not found/i.test(text))
		return '配置未提交或 netifd 尚未载入该接口';

	return text.replace(/^.*?(?:daemon|kern|user)\.[^:]+:\s*/, '').trim() || 'PPP 拨号失败';
}

function latestFailure(lines) {
	for (var i = lines.length - 1; i >= 0; i--) {
		if (classifyLine(lines[i]) === 'error')
			return lines[i];
	}

	return null;
}

function statusOf(section, runtime) {
	var disabled = section.disabled === '1';
	var autostart = section.auto !== '0';
	var errors = asArray(runtime && runtime.errors);

	if (runtime && runtime.up)
		return { key: 'online', text: (disabled || !autostart) ? '已连接（手动）' : '已连接' };

	if (runtime && runtime.pending)
		return { key: 'pending', text: '连接中' };

	if (errors.length)
		return { key: 'failed', text: '失败' };

	if (runtime && runtime.available === false)
		return { key: 'failed', text: '不可用' };

	if (disabled)
		return { key: 'disabled', text: '已禁用' };

	if (!autostart)
		return { key: 'disabled', text: '未启动' };

	if (!runtime)
		return { key: 'unknown', text: '未载入' };

	return { key: 'failed', text: '已断开' };
}

function formatUptime(seconds) {
	var total = Number(seconds);

	if (!isFinite(total) || total < 0)
		return '—';

	var days = Math.floor(total / 86400);
	var hours = Math.floor((total % 86400) / 3600);
	var minutes = Math.floor((total % 3600) / 60);
	var secs = Math.floor(total % 60);
	var parts = [];

	if (days)
		parts.push(days + ' 天');
	if (hours || days)
		parts.push(hours + ' 小时');
	if (minutes || hours || days)
		parts.push(minutes + ' 分');
	parts.push(secs + ' 秒');

	return parts.join(' ');
}

function ipv4Of(runtime) {
	var values = asArray(runtime && runtime['ipv4-address']);

	return values
		.map(function(entry) { return entry && entry.address; })
		.filter(Boolean)
		.join(', ') || '—';
}

function errorOf(runtime) {
	var errors = asArray(runtime && runtime.errors).filter(Boolean).map(function(error) {
		if (typeof error === 'string')
			return error;

		if (!error || typeof error !== 'object')
			return String(error);

		var code = String(error.code || '');
		var labels = {
			CONNECT_FAILED: '连接失败：PPPoE Discovery 或链路建立失败',
			NOT_FOUND: 'netifd 尚未载入该接口',
			FATAL_ERROR: '拨号致命错误',
			OPTION_ERROR: 'PPPoE 配置参数错误',
			NEGOTIATION_FAILED: 'PPP 协商失败',
			PEER_AUTH_FAILED: '上游认证失败',
			AUTH_TOPEER_FAILED: '本端认证失败',
			PEER_DEAD: '上游 PPP 对端无响应',
			HANGUP: 'PPP 链路挂断',
			USER_REQUEST: '拨号被主动终止'
		};
		var text = labels[code] || code || '未知错误';

		return error.subsystem ? error.subsystem + '：' + text : text;
	});

	return errors.length ? errors.join('；') : '—';
}

function rowFor(section, runtime, latest) {
	var status = statusOf(section, runtime);
	var name = section['.name'];
	var reason = errorOf(runtime);

	if (reason === '—' && status.key === 'failed' && latest)
		reason = describeFailure(latest);

	return E('tr', {}, [
		E('td', {}, [
			E('span', { 'class': 'pppoe-diag-interface' }, name),
			E('span', { 'class': 'pppoe-diag-sub' }, 'PPPoE')
		]),
		E('td', {}, section.device || '—'),
		E('td', {}, runtime && runtime.l3_device || '—'),
		E('td', {}, E('span', { 'class': 'pppoe-diag-badge ' + status.key }, status.text)),
		E('td', {}, runtime && runtime.up ? formatUptime(runtime.uptime) : '—'),
		E('td', {}, ipv4Of(runtime)),
		E('td', {}, E('span', {
			'class': status.key === 'failed' ? 'pppoe-diag-error' : 'pppoe-diag-muted'
		}, reason))
	]);
}

function renderTable(rows) {
	if (!rows.length)
		return E('div', { 'class': 'pppoe-diag-empty' }, '没有 PPPoE 配置');

	return E('div', { 'class': 'pppoe-diag-table-wrap' }, E('table', { 'class': 'pppoe-diag-table' }, [
		E('thead', {}, E('tr', {}, [
			E('th', {}, '配置'),
			E('th', {}, '设备'),
			E('th', {}, 'L3 接口'),
			E('th', {}, '状态'),
			E('th', {}, '运行时间'),
			E('th', {}, 'IPv4'),
			E('th', {}, 'netifd 错误')
		])),
		E('tbody', {}, rows)
	]));
}

function renderSummary(rows) {
	var total = rows.length;
	var online = rows.filter(function(row) { return row.status.key === 'online'; }).length;
	var failed = rows.filter(function(row) { return row.status.key === 'failed'; }).length;
	var disabled = rows.filter(function(row) { return row.status.key === 'disabled'; }).length;

	return E('div', { 'class': 'pppoe-diag-summary' }, [
		E('div', { 'class': 'pppoe-diag-stat' }, [
			E('span', { 'class': 'pppoe-diag-stat-label' }, 'PPPoE 配置'),
			E('span', { 'class': 'pppoe-diag-stat-value' }, String(total))
		]),
		E('div', { 'class': 'pppoe-diag-stat' }, [
			E('span', { 'class': 'pppoe-diag-stat-label' }, '已连接'),
			E('span', { 'class': 'pppoe-diag-stat-value', 'style': 'color:var(--pppoe-green)' }, String(online))
		]),
		E('div', { 'class': 'pppoe-diag-stat' }, [
			E('span', { 'class': 'pppoe-diag-stat-label' }, '失败'),
			E('span', { 'class': 'pppoe-diag-stat-value', 'style': 'color:var(--pppoe-red)' }, String(failed))
		]),
		E('div', { 'class': 'pppoe-diag-stat' }, [
			E('span', { 'class': 'pppoe-diag-stat-label' }, '禁用或未启动'),
			E('span', { 'class': 'pppoe-diag-stat-value', 'style': 'color:var(--pppoe-orange)' }, String(disabled))
		])
	]);
}

function currentFailure(rows) {
	for (var i = 0; i < rows.length; i++) {
		var runtime = rows[i].runtime;
		var errors = asArray(runtime && runtime.errors);

		if (errors.length)
			return {
				name: rows[i].section['.name'],
				reason: errorOf(runtime)
			};
	}

	return null;
}

function renderLatest(lines, rows) {
	var current = currentFailure(rows || []);
	var failure = current ? null : latestFailure(lines);

	if (current)
		return E('div', { 'class': 'pppoe-diag-latest' }, [
			E('span', { 'class': 'pppoe-diag-latest-title' }, '当前 netifd 错误'),
			E('span', {}, current.name + '：' + current.reason)
		]);

	if (failure)
		return E('div', { 'class': 'pppoe-diag-latest' }, [
			E('span', { 'class': 'pppoe-diag-latest-title' }, '最近失败原因'),
			E('span', {}, describeFailure(failure)),
			E('span', { 'class': 'pppoe-diag-sub' }, failure)
		]);

	return E('div', { 'class': 'pppoe-diag-latest ok' }, [
		E('span', { 'class': 'pppoe-diag-latest-title' }, '最近失败原因'),
		E('span', {}, '本次启动周期内未发现 PPPoE 失败日志')
	]);
}

function matchesFilter(line, filter) {
	var kind = classifyLine(line);

	if (filter === 'errors')
		return kind === 'error';
	if (filter === 'success')
		return kind === 'success';
	if (filter === 'state')
		return kind === 'state';

	return true;
}

function renderLogs(lines, filter) {
	var visible = lines.filter(function(line) { return matchesFilter(line, filter); });

	if (!visible.length)
		return E('div', { 'class': 'pppoe-diag-empty' }, '当前筛选条件下没有日志');

	return visible.map(function(line) {
		return E('span', { 'class': 'pppoe-diag-log-line ' + classifyLine(line) }, line);
	});
}

function collectState(data) {
	var sections = uci.sections('network', 'interface').filter(function(section) {
		return section.proto === 'pppoe';
	});
	var runtime = data.interfaces && data.interfaces.interface || [];
	var byName = {};

	runtime.forEach(function(entry) {
		if (entry && entry.interface)
			byName[entry.interface] = entry;
	});
	asArray(data.statuses).forEach(function(entry) {
		if (entry && entry.interface)
			byName[entry.interface] = entry;
	});

	var logsText = String(data.logs && data.logs.text || '');
	var lines = logsText ? logsText.replace(/\r/g, '').split('\n').filter(Boolean) : [];
	var latest = latestFailure(lines);
	var rows = sections.map(function(section) {
		var status = statusOf(section, byName[section['.name']]);
		return {
			section: section,
			runtime: byName[section['.name']],
			status: status,
			latest: latest
		};
	});

	return {
		rows: rows,
		lines: lines,
		latest: latest
	};
}

function fetchState() {
	var sections = uci.sections('network', 'interface').filter(function(section) {
		return section.proto === 'pppoe' && section.disabled !== '1' && section.auto !== '0';
	});
	var statusJobs = sections.map(function(section) {
		var name = section['.name'];
		return L.resolveDefault(callStatus(name), {
			interface: name,
			up: false,
			pending: false,
			available: false,
			errors: [ { subsystem: 'netifd', code: 'NOT_FOUND' } ]
		}).then(function(status) {
			status.interface = name;
			return status;
		});
	});

	return Promise.all([
		L.resolveDefault(callInterfaces(), { interface: [] }),
		L.resolveDefault(callLogs(), { text: '', lines: 0 }),
		Promise.all(statusJobs)
	]).then(function(results) {
		return {
			interfaces: results[0] || { interface: [] },
			logs: results[1] || { text: '', lines: 0 },
			statuses: results[2] || []
		};
	});
}

return view.extend({
	load: function() {
		return uci.load('network').then(fetchState);
	},

	render: function(data) {
		ensureStylesheet();
		this.filter = 'all';
		this.state = collectState(data || {});
		this.summaryNode = E('div');
		this.tableNode = E('div');
		this.latestNode = E('div');
		this.logNode = E('div');
		this.timeNode = E('span', { 'class': 'pppoe-diag-time' });

		var refreshButton = E('button', {
			'class': 'cbi-button cbi-button-action',
			'click': ui.createHandlerFn(this, 'handleRefresh')
		}, '立即刷新');

		var filterSelect = E('select', {
			'aria-label': '日志筛选',
			'change': function(ev) {
				this.filter = ev.currentTarget.value;
				this.replaceLogs();
			}.bind(this)
		}, [
			E('option', { 'value': 'all' }, '全部日志'),
			E('option', { 'value': 'errors' }, '仅失败'),
			E('option', { 'value': 'success' }, '仅成功'),
			E('option', { 'value': 'state' }, '仅接口状态')
		]);

		this.renderState();

		var root = E('div', { 'class': 'cbi-map pppoe-diag' }, [
			E('h2', {}, 'PPPoE 诊断'),
			this.summaryNode,
			E('div', { 'class': 'pppoe-diag-toolbar' }, [
				refreshButton,
				E('span', { 'class': 'spacer' }),
				filterSelect,
				this.timeNode
			]),
			this.tableNode,
			this.latestNode,
			E('div', { 'class': 'pppoe-diag-log-head' }, [
				E('h3', {}, 'PPPoE / netifd 日志'),
				E('span', { 'class': 'pppoe-diag-muted' }, '自动刷新，每 5 秒')
			]),
			this.logNode
		]);

		poll.add(L.bind(this.refresh, this), 5);
		return root;
	},

	renderState: function() {
		this.summaryNode.replaceChildren(renderSummary(this.state.rows));
		this.tableNode.replaceChildren(renderTable(this.state.rows.map(function(row) {
			return rowFor(row.section, row.runtime, row.latest);
		})));
		this.latestNode.replaceChildren(renderLatest(this.state.lines, this.state.rows));
		this.replaceLogs();
		this.timeNode.textContent = '采集时间 ' + new Date().toLocaleTimeString();
	},

	replaceLogs: function() {
		var nodes = [].concat(renderLogs(this.state.lines, this.filter));
		this.logNode.replaceChildren.apply(this.logNode, nodes);
	},

	refresh: function() {
		return fetchState().then(L.bind(function(data) {
			this.state = collectState(data);
			this.renderState();
		}, this));
	},

	handleRefresh: function(ev) {
		var button = ev.currentTarget;

		button.disabled = true;
		button.classList.add('spinning');

		return this.refresh().finally(function() {
			button.disabled = false;
			button.classList.remove('spinning');
		});
	}
});
