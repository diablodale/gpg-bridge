// commitlint.config.js
// Enforces Conventional Commits v1 format on all commit messages.
// https://www.conventionalcommits.org/
// https://commitlint.js.org/
/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        // config-conventional sets this to warning (level 1); promote to error (level 2).
        'body-leading-blank': [2, 'always'],
        // Same for footer.
        'footer-leading-blank': [2, 'always'],
    },
};
