// Extends app.json. BASE_URL=SunScreen serves the web build from /SunScreen/ on GitHub Pages (see `make pages`).
// The slash is added here because Git Bash on Windows rewrites env values that start with "/".
export default ({ config }) => ({
  ...config,
  experiments: { ...config.experiments, baseUrl: process.env.BASE_URL ? `/${process.env.BASE_URL}` : "" },
});
