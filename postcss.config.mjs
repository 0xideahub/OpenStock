import tailwindcss from '@tailwindcss/postcss';

const plugins = [];

if (!process.env.VITEST) {
  plugins.push(tailwindcss());
}

export default {
  plugins,
};
