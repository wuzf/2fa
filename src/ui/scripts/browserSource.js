/**
 * Serialization boundary for self-contained browser closures. esbuild keepNames
 * annotates nested functions using a bundle-local helper. A same-bundle probe
 * identifies only that helper; arbitrary missing closure dependencies stay errors.
 */
function browserNameProbe() {
	function twofaSerializedNameProbe() {}
	return twofaSerializedNameProbe;
}

export function serializeBrowserFunction(callable) {
	const source = Function.prototype.toString.call(callable);
	const probe = Function.prototype.toString.call(browserNameProbe);
	const helper = probe.match(/([A-Za-z_$][\w$]*)\(\s*[A-Za-z_$][\w$]*\s*,\s*["']twofaSerializedNameProbe["']\s*\)/)?.[1];
	if (!helper) {
		return '(' + source + ')';
	}
	return (
		'(() => { const ' +
		helper +
		' = (value, name) => Object.defineProperty(value, "name", {value: name, configurable: true}); return (' +
		source +
		'); })()'
	);
}
