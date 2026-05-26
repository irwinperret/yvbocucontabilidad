import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, PlusCircle, DollarSign, FileText, TrendingUp,
  Users, FileInput, FileOutput, LogOut,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useMode } from "@/lib/mode-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

const registroItems = [
  { title: "Inicio", url: "/dashboard", icon: LayoutDashboard },
  { title: "Tasa BCV", url: "/tasa", icon: DollarSign },
  { title: "Registrar mov.", url: "/registrar", icon: PlusCircle },
  { title: "Cuentas por cobrar", url: "/cxc", icon: FileInput },
  { title: "Cuentas por pagar", url: "/cxp", icon: FileOutput },
  { title: "Terceros", url: "/terceros", icon: Users },
];
const analisisItems = [
  { title: "G&P (Ganancias)", url: "/gyp", icon: TrendingUp },
  { title: "Flujo de caja", url: "/fc", icon: FileText },
  { title: "Cuentas por cobrar", url: "/cxc", icon: FileInput },
  { title: "Cuentas por pagar", url: "/cxp", icon: FileOutput },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { mode } = useMode();
  const { signOut, user } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const items = mode === "registro" ? registroItems : analisisItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="px-2 py-3">
          {!collapsed && (
            <>
              <div className="text-sm font-bold tracking-tight">YV / Bocú / Market</div>
              <div className="text-xs text-muted-foreground mt-0.5">Sistema financiero</div>
            </>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {mode === "registro" ? "Registro" : "Análisis"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={path === item.url}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        {!collapsed && (
          <div className="px-2 py-2 text-xs text-muted-foreground truncate">{user?.email}</div>
        )}
        <Button variant="ghost" size="sm" onClick={() => signOut()} className="justify-start">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Salir</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
