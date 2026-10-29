import type { LucideIcon } from "lucide-react";
import { Home, PlusCircle, ShieldCheck, Sparkles } from "lucide-react";
import {
  registroImportar,
  registroGestion,
  registroGestionEnConstruccion,
  analisisPrincipales,
  analisisEnConstruccion,
  analisisDetalles,
  analisisHerramientasSecundarias,
} from "@/components/app-sidebar";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  mode: "registro" | "analisis";
  group: string;
};

type ItemCrudo = { title: string; url: string; icon: LucideIcon };

// Las 4 entradas que viven sueltas en el JSX del sidebar (no en un array),
// porque no pertenecen a ningún submenú colapsable.
const sueltos: NavItem[] = [
  { title: "Inicio", url: "/inicio", icon: Home, mode: "registro", group: "Registro" },
  { title: "Registrar Movimiento", url: "/registrar", icon: PlusCircle, mode: "registro", group: "Registro" },
  { title: "Iris", url: "/iris", icon: ShieldCheck, mode: "registro", group: "Registro" },
  { title: "Análisis AI", url: "/analisis-ai", icon: Sparkles, mode: "analisis", group: "Análisis" },
];

function etiquetar(items: ItemCrudo[], mode: "registro" | "analisis", group: string): NavItem[] {
  return items.map((i) => ({ ...i, mode, group }));
}

const todos: NavItem[] = [
  ...sueltos,
  ...etiquetar(registroImportar, "registro", "Entradas del mes"),
  ...etiquetar(registroGestion, "registro", "Gestión"),
  ...etiquetar(registroGestionEnConstruccion, "registro", "Gestión (en construcción)"),
  ...etiquetar(analisisPrincipales, "analisis", "Análisis"),
  ...etiquetar(analisisEnConstruccion, "analisis", "Análisis (en construcción)"),
  ...etiquetar(analisisDetalles, "analisis", "Detalles contables"),
  ...etiquetar(analisisHerramientasSecundarias, "analisis", "Herramientas secundarias"),
];

// Varias rutas (Tasa BCV, Tasa paralela, Saldos bancarios, CxC) aparecen en
// ambos modos del sidebar -- acá se deduplican por url, quedándose con la
// primera aparición, para no listarlas dos veces en el buscador.
const vistos = new Set<string>();
export const NAV_ITEMS: NavItem[] = todos.filter((item) => {
  if (vistos.has(item.url)) return false;
  vistos.add(item.url);
  return true;
});

// Orden de despliegue de los grupos en el buscador -- mismo orden en que
// aparecen las secciones en el sidebar real.
export const ORDEN_GRUPOS = [
  "Registro",
  "Entradas del mes",
  "Gestión",
  "Gestión (en construcción)",
  "Análisis",
  "Detalles contables",
  "Herramientas secundarias",
  "Análisis (en construcción)",
];
