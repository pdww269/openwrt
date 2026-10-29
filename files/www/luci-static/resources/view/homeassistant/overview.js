'use strict';
'require view';

return view.extend({
	render: function() {
		var target = 'http://' + window.location.hostname + ':8123/';

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Home Assistant')),
			E('div', { 'class': 'cbi-map-descr' },
				E('a', {
					'class': 'btn cbi-button cbi-button-apply',
					'href': target,
					'target': '_blank',
					'rel': 'noopener noreferrer'
				}, _('在新标签页打开 Home Assistant'))
			),
			E('p', {}, [
				E('a', { 'href': target, 'target': '_blank', 'rel': 'noopener noreferrer' }, target)
			])
		]);
	}
});
