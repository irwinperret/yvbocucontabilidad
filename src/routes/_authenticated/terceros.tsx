import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/terceros")({
  beforeLoad: () => { throw redirect({ to: "/proveedores" }); },
});
