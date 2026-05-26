import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const verifySiteAccess = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ password: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const expected = process.env.SITE_ACCESS_PASSWORD;
    if (!expected) throw new Error("SITE_ACCESS_PASSWORD no configurado");
    return { ok: data.password === expected };
  });
