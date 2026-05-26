import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  Home, PlusCircle, DollarSign, FileText, TrendingUp, Users, FileInput, FileOutput,
  LogOut, Settings, ChevronDown, ChevronRight, BookOpen, Layers, AlertTriangle, LayoutDashboard, Landmark,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useMode } from "@/lib/mode-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

const registroDirectos = [
  { title: "Inicio", url: "/inicio", icon: Home },
  { title: "Registrar movimiento", url: "/registrar", icon: PlusCircle },
];

const registroGestion = [
  { title: "Tasa BCV", url: "/tasa", icon: DollarSign },
  { title: "Cuentas por pagar", url: "/pagar-cxp", icon: FileOutput },
  { title: "Cuentas por cobrar", url: "/cxc", icon: FileInput },
  { title: "Proveedores", url: "/proveedores", icon: Users },
  { title: "Cuentas bancarias", url: "/cuentas-bancarias", icon: Landmark },
];

const analisisItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "G&P", url: "/gyp", icon: TrendingUp },
  { title: "Flujo de caja", url: "/fc", icon: FileText },
  { title: "CxC pendientes", url: "/cxc", icon: FileInput },
  { title: "CxP pendientes", url: "/cxp", icon: FileOutput },
  { title: "Plan de cuentas", url: "/plan-cuentas", icon: BookOpen },
  { title: "Tasa BCV", url: "/tasa", icon: DollarSign },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { mode } = useMode();
  const { signOut, user } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [gestionOpen, setGestionOpen] = useState(false);

  const isActive = (url: string) => path === url;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="px-2 py-3">
          {!collapsed && (
            <>
              <div className="text-sm font-bold tracking-tight">YV · Bocú · Market</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                {mode === "registro" ? "Modo registro" : "Modo análisis"}
              </div>
            </>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {mode === "registro" ? (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {registroDirectos.map((item) => {
                    const highlight = item.url === "/registrar";
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          className={highlight ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground font-semibold shadow-sm ring-1 ring-primary/40" : ""}
                        >
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4" />
                            {!collapsed && <span>{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setGestionOpen((v) => !v)} className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">Gestión</span>
                          {gestionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {gestionOpen && registroGestion.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-7"}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Análisis</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {analisisItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
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
        )}
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
