import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "domainlint",
      description:
        "Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.",
      social: {
        github: "https://github.com/gpichot/domainlint",
      },
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Getting Started", slug: "getting-started" },
          ],
        },
        {
          label: "About",
          items: [
            { label: "Philosophy & Vision", slug: "philosophy" },
          ],
        },
      ],
    }),
  ],
});
