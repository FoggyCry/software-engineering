import { defineConfig } from "vite";
export default defineConfig(({ command }) => ({
  base: "/software-engineering/",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      process.env.npm_package_version,
    ),
  },
  plugins: [
    {
      name: "production-security-policy",
      transformIndexHtml(html) {
        if (command !== "build") return html;
        return html.replace(
          "<head>",
          "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'\"><meta name=\"referrer\" content=\"no-referrer\">",
        );
      },
    },
  ],
}));
