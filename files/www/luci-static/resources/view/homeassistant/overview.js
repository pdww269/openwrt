'use strict';
'require view';

return view.extend({
	render: function() {
		var h = window.location.hostname || '';
		var isLan = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h);
		var target = isLan
			? 'http://' + h + ':8123/'
			: 'https://' + h + ':47189/';
		var label = isLan ? '内网直连' : '外网加密（mTLS）';

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Home Assistant')),
			E('div', { 'class': 'cbi-map-descr' },
				E('a', {
					'class': 'btn cbi-button cbi-button-apply',
					'href': target,
					'target': '_blank',
					'rel': 'noopener noreferrer'
				}, _('在新标签页打开 Home Assistant') + '（' + label + '）')
			),
			E('p', {}, [
				E('a', { 'href': target, 'target': '_blank', 'rel': 'noopener noreferrer' }, target)
			])
		]);
	}
});
