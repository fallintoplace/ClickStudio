export default {
    rules: {
        'at-rule-no-unknown': [true, { ignoreAtRules: ['theme'] }],
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-values'] }],
        'declaration-no-important': true,
        'declaration-property-value-no-unknown': true,
        'function-no-unknown': true,
        'no-duplicate-selectors': true,
        'property-no-unknown': true,
        'selector-pseudo-class-no-unknown': true,
        'selector-pseudo-element-no-unknown': true,
        'unit-no-unknown': true,
    },
};
