// @ts-check
import { defineConfig } from "astro/config";

// import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

import alpinejs from "@astrojs/alpinejs";

import markdoc from "@astrojs/markdoc";

import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  integrations: [
    alpinejs(),
    markdoc(),
    starlight({
      title: "HASHVAULT",
      disable404Route: true,
      components: {
        Header: "./src/components/DocsHeader.astro",
        ThemeProvider: "./src/components/ForceDarkTheme.astro",
        ThemeSelect: "./src/components/EmptyComponent.astro",
      },
      customCss: [
        "./src/styles/global.css",
        "@fontsource/archivo-black/400.css",
      ],
    }),
  ],
  vite: {
    css: {
      transformer: "lightningcss",
    },
    plugins: [tailwindcss()],
  },
});
