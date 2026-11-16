import {defineConfig} from 'vite';

const api = 'http://localhost:8765';

export default defineConfig({
  oxc: {jsx: {runtime: 'automatic'}},
  server: {port: 5173, proxy: {'/api': api, '/files': api}},
});
