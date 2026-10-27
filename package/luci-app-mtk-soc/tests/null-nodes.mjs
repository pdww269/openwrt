import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sourceUrl = new URL('../htdocs/luci-static/resources/view/mtk_soc/ui.js', import.meta.url);
const source = await fs.readFile(sourceUrl, 'utf8');

function fakeNode(tag, attrs, data) {
	const children = [];

	function append(value) {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && item.__node)
					children.push(item);
				else if (item === null || item === undefined)
					children.push('null');
				else
					children.push(String(item));
			}
		} else if (value !== null && value !== undefined) {
			children.push(String(value));
		}
	}

	append(data);
	return { __node: true, tag, attrs, children };
}

function text(node) {
	if (!node || !node.__node)
		return String(node);
	return node.children.map(text).join('');
}

const fakeWindow = { E: fakeNode };
const baseclass = { extend: value => value };
const factory = new Function('window', 'document', 'L', 'baseclass', 'tokens',
	`${source}\n//# sourceURL=${sourceUrl}`);
const ui = factory(fakeWindow, {}, {}, baseclass, { tokens: '', dark: '' });

const output = [
	ui.tile({ title: 'NPU 状态', value: '已激活', unit: null, sub: 'MT7988 PPE', accent: null }),
	ui.section({ title: 'PPE 引擎', hint: null, count: '16 / 105', actions: null, body: 'body' }),
	ui.card({ name: 'PPE0', tag: null, body: 'body' })
].map(text).join('\n');

assert.doesNotMatch(output, /\bnull\b/);
assert.match(output, /NPU 状态/);
assert.match(output, /PPE0/);

console.log('MediaTek SoC null-node regression test: ok');
