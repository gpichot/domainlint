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
        { label: "Getting Started", slug: "getting-started" },
        { label: "Configuration", slug: "configuration" },
        { label: "CLI Reference", slug: "cli" },
        { label: "Rules", slug: "rules" },
        { label: "Custom Rules", slug: "custom-rules" },
        { label: "GraphQuery API", slug: "graphquery-api" },
        { label: "Workspaces", slug: "workspaces" },
        { label: "CI Integration", slug: "ci" },
        { label: "Philosophy", slug: "philosophy" },
      ],
    }),
  ],
});
