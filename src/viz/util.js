export function clamp01(x) {
	return Math.max(0, Math.min(1, x));
}

export function fmtMoney(x) {
	const sign = x < 0 ? "-" : "";
	return `${sign}$${Math.round(Math.abs(x))}`;
}
