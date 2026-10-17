// Decides whether a focused element is a credit card field. It only ever reads the attributes
// type, autocomplete, name, id, placeholder, aria-label, disabled and readonly. Never the value.
const TYPES = ['', 'text', 'tel', 'number', 'password'];
const AUTOCOMPLETE = ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-name'];

// Gift card, promo and similar fields mention "card" or "number" but aren't payment cards.
const EXCLUDED = /\b(gift|promo|coupon|voucher|loyalty|membership|discount)\b/;
const PATTERNS = [
	/\b(cc|card|credit card)\s?(num|number|no)\b/,
	/\b(cardnumber|ccnum|ccnumber)\b/,
	/\b(cvc|cvv|cvv2|csc|cvn)\b/,
	/\bcard\s?(security|verification)\s?code\b/,
	/\b(cc|card)\s?exp/,
	/\bexp(iry|iration)?\s?(date|month|year|mm|yy)\b/,
	/\bname\s?on\s?card\b|\bcard\s?holder\b|\bcardholder\b/,
];

function hintFor(input: HTMLInputElement): string {
	return ['name', 'id', 'placeholder', 'aria-label']
		.map((attribute) => input.getAttribute(attribute) ?? '')
		.join(' ')
		// "cardNumber" -> "card Number", so camelCase names match the word patterns.
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[_\-.[\]:]+/g, ' ');
}

export function isCardField(element: Element): boolean {
	// localName instead of instanceof: the element may come from another frame's realm.
	if (element.localName !== 'input') {
		return false;
	}

	const input = element as HTMLInputElement;
	if (!TYPES.includes((input.getAttribute('type') ?? '').toLowerCase()) || input.disabled || input.readOnly) {
		return false;
	}

	const tokens = (input.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
	if (tokens.some((token) => AUTOCOMPLETE.includes(token))) {
		return true;
	}

	const hint = hintFor(input);
	return !EXCLUDED.test(hint) && PATTERNS.some((pattern) => pattern.test(hint));
}

// composedPath()[0] sees through open shadow roots, where event.target is only the shadow host.
export function cardFieldFromEvent(event: Event): HTMLInputElement | undefined {
	const target = event.composedPath()[0] as Element | undefined;
	// Duck-typed: instanceof Element fails for nodes from another frame's realm.
	return typeof target?.localName === 'string' && isCardField(target) ? target as HTMLInputElement : undefined;
}
