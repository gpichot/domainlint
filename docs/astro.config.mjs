import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "domainlint",
      description:
        "Architecture linter for TypeScript/JavaScript codebases. Enforces feature boundary rules and detects import cycles.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/gpichot/domainlint",
        },
      ],
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Getting Started", slug: "getting-started" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Rules & Schema", slug: "rules" },
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
