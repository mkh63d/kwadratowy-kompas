import type { ReactElement } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { z } from "zod";
import { HomePage } from "../routes/HomePage";
import { NotFoundPage } from "../routes/NotFoundPage";
import { Layout, type NavItem } from "./Layout";

const featureSchema = z.object({
  path: z.string().regex(/^\/[^*]+$/, "path must start with / and be concrete"),
  navLabel: z.string().min(1),
  order: z.number(),
  element: z.custom<ReactElement>(
    (value) => typeof value === "object" && value !== null,
    "element must be a React element",
  ),
});

export type Feature = z.infer<typeof featureSchema>;
export type FeatureModules = Record<string, { default: unknown }>;

export function collectFeatures(modules: FeatureModules): Feature[] {
  return Object.entries(modules)
    .map(([file, mod]) => {
      const parsed = featureSchema.safeParse(mod.default);
      if (!parsed.success) {
        throw new Error(
          `Invalid feature module ${file}: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`,
        );
      }
      return parsed.data;
    })
    .sort((a, b) => a.order - b.order);
}

export function buildRoutes(
  features: Feature[],
  offline: boolean,
): RouteObject[] {
  const nav: NavItem[] = features.map((f) => ({
    path: f.path,
    label: f.navLabel,
  }));
  return [
    {
      element: <Layout nav={nav} offline={offline} />,
      children: [
        { path: "/", element: <HomePage /> },
        ...features.map((f) => ({ path: f.path, element: f.element })),
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ];
}

export function createAppRouter(offline: boolean) {
  const modules = import.meta.glob("../features/*/feature.tsx", {
    eager: true,
  }) as FeatureModules;
  return createBrowserRouter(buildRoutes(collectFeatures(modules), offline));
}
