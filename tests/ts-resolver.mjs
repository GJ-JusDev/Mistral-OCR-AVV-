import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// In Node 20.6+, register() registers a module customization hook
register('./ts-loader.mjs', pathToFileURL('./tests/'));
