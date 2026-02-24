import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  if (command === 'build') {
    return {
      plugins: [react()],
      base: '/Dwindle/',
    };
  }

  return {
    plugins: [react()],
  };
});
