import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        ignores: ['admin/build/**', 'build/**', 'test/**/*.js', 'scripts/**'],
    },
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' },
            ],
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
    {
        files: ['**/*.test.ts'],
        languageOptions: { globals: globals.mocha },
    },
];
