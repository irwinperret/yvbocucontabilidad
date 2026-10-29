import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useMode } from "@/lib/mode-context";
import { NAV_ITEMS, ORDEN_GRUPOS } from "@/lib/nav-items";

/**
 * Buscador rápido (Cmd/Ctrl+K) de las ~40 pantallas de la app. Antes solo se
 * podía llegar a cada pantalla navegando el sidebar (que tiene varios
 * submenús colapsables repartidos en dos modos); esto permite saltar
 * directo escribiendo el nombre, sin importar en qué modo estés parado.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { setMode } = useMode();

  const ir = (url: string, mode: "registro" | "analisis") => {
    setMode(mode);
    navigate({ to: url });
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar una pantalla..." />
      <CommandList>
        <CommandEmpty>No se encontró ninguna pantalla.</CommandEmpty>
        {ORDEN_GRUPOS.map((grupo) => {
          const items = NAV_ITEMS.filter((i) => i.group === grupo);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={grupo} heading={grupo}>
              {items.map((item) => (
                <CommandItem
                  key={item.url}
                  value={`${item.title} ${item.url}`}
                  onSelect={() => ir(item.url, item.mode)}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
