import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home,
  PlusCircle,
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  FileInput,
  FileOutput,
  LogOut,
  Settings,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Layers,
  AlertTriangle,
  LayoutDashboard,
  BarChart3,
  Landmark,
  Lock,
  ListChecks,
  ArrowLeftRight,
  Wallet,
  Upload,
  Building2,
  Receipt,
  Sparkles,
  PauseCircle,
  ShieldCheck,

} from "lucide-react";
import { History as HistoryIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMode } from "@/lib/mode-context";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

const registroImportar = [
  { title: "Importar ventas (Xetux)", url: "/importar-ventas", icon: Upload },
  { title: "Importar compras (Xetux)", url: "/importar-compras", icon: Upload },
  { title: "Importar movimientos bancarios", url: "/importar-movimientos", icon: Landmark },
  { title: "Importar ajustes ventas", url: "/importar-ajustes", icon: Upload },
  { title: "Historial de importaciones", url: "/importaciones", icon: HistoryIcon },
  { title: "Cierres de Mes", url: "/cierres-de-mes", icon: Lock },
];


const registroGestion = [
  { title: "Transacciones", url: "/transacciones", icon: ListChecks },
  { title: "Transacciones en Standby", url: "/standby", icon: PauseCircle },
  { title: "Movimientos bancarios", url: "/movimientos-bancarios", icon: ArrowLeftRight },
  { title: "Tasa BCV", url: "/tasa", icon: DollarSign },
  { title: "Tasa paralela", url: "/tasa-paralela", icon: ArrowLeftRight },
  { title: "Cuentas por pagar", url: "/pagar-cxp", icon: FileOutput },
  { title: "Cuentas por cobrar", url: "/cxc", icon: FileInput },
  { title: "Proveedores", url: "/proveedores", icon: Users },
  { title: "Cuentas bancarias", url: "/cuentas-bancarias", icon: Landmark },
  { title: "Saldos bancarios", url: "/saldos-bancarios", icon: Wallet },
];

const analisisPrincipales = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "G&P", url: "/gyp", icon: TrendingUp },
];

const analisisEnConstruccion = [
  { title: "Impuestos", url: "/impuestos", icon: Receipt },
  { title: "Flujo de caja", url: "/fc", icon: FileText },
  { title: "Saldos bancarios", url: "/saldos-bancarios", icon: Wallet },
  { title: "CxC pendientes", url: "/cxc", icon: FileInput },
  { title: "CxP pendientes", url: "/cxp", icon: FileOutput },
  { title: "Activos transitorios", url: "/activos-transitorios", icon: Wallet },
];

const analisisDetalles = [
  { title: "CapEx", url: "/capex", icon: Building2 },
  { title: "Aumento de capital", url: "/aumento-capital", icon: TrendingUp },
  { title: "Liquidaciones", url: "/liquidaciones", icon: Users },
  { title: "Anticipos a proveedores", url: "/anticipos-proveedores", icon: Users },
  { title: "Inventarios", url: "/inventarios", icon: BookOpen },
  { title: "Plan de cuentas", url: "/plan-cuentas", icon: BookOpen },
  { title: "Tasa BCV", url: "/tasa", icon: DollarSign },
  { title: "Tasa paralela", url: "/tasa-paralela", icon: ArrowLeftRight },
  { title: "Operaciones de Cambio", url: "/operaciones-cambio", icon: ArrowLeftRight },
  { title: "Propinas", url: "/propinas", icon: DollarSign },
  { title: "Bonos 10%", url: "/bonos10", icon: DollarSign },
  { title: "Resumen IPA", url: "/resumen-ejecutivo", icon: BarChart3 },
  { title: "Resumen IPA Mensual", url: "/resumen-ejecutivo-mensual", icon: BarChart3 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { mode } = useMode();
  const { signOut, user } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [importarOpen, setImportarOpen] = useState(true);
  const [gestionOpen, setGestionOpen] = useState(false);
  const [detallesOpen, setDetallesOpen] = useState(false);
  const [enConstruccionOpen, setEnConstruccionOpen] = useState(false);

  const isActive = (url: string) => path === url;

  // "En construcción" siempre debe verse minimizado por defecto: solo se
  // mantiene abierto mientras se está navegando dentro de sus propias
  // pantallas, y se vuelve a cerrar solo en cuanto sales de ahí.
  useEffect(() => {
    if (!analisisEnConstruccion.some((item) => item.url === path)) {
      setEnConstruccionOpen(false);
    }
  }, [path]);

  return (
    <Sidebar
      collapsible="icon"
      className={
        mode === "analisis"
          ? "[&_[data-sidebar=sidebar]]:bg-[#E8F5F0] [&_[data-sidebar=sidebar]]:border-[#0F6E56]/20 [&_[data-active=true]]:bg-[#0F6E56] [&_[data-active=true]]:text-white [&_[data-active=true]]:font-bold hover:[&_[data-active=true]]:bg-[#0F6E56] hover:[&_[data-active=true]]:text-white"
          : "[&_[data-sidebar=sidebar]]:bg-[#EEECFA] [&_[data-sidebar=sidebar]]:border-[#534AB7]/20 [&_[data-active=true]]:bg-[#534AB7] [&_[data-active=true]]:text-white [&_[data-active=true]]:font-bold hover:[&_[data-active=true]]:bg-[#534AB7] hover:[&_[data-active=true]]:text-white"
      }
    >
      <SidebarHeader className="border-b">
        <div className="px-2 py-3">
          {!collapsed && (
            <>
              <div className="text-sm font-bold tracking-tight">YV · Bocú</div>
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
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/inicio")}>
                      <Link to="/inicio" className="flex items-center gap-2">
                        <Home className="h-4 w-4" />
                        {!collapsed && <span>Inicio</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setImportarOpen((v) => !v)} className="flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left font-bold">Importar Archivos</span>
                          {importarOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {importarOpen &&
                    registroImportar.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-7"}>
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-3.5 w-3.5" />
                            {!collapsed && <span className="text-sm">{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}

                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/registrar")} className="font-bold">
                      <Link to="/registrar" className="flex items-center gap-2">
                        <PlusCircle className="h-4 w-4" />
                        {!collapsed && <span>Registrar Movimiento</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
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
                          {gestionOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {gestionOpen &&
                    registroGestion.map((item: any) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-7"}>
                          <Link to={item.url} className={`flex items-center gap-2 ${item.especial ? "font-bold text-purple-600" : ""}`}>
                            <item.icon className={`h-3.5 w-3.5 ${item.especial ? "text-purple-600" : ""}`} />
                            {!collapsed && <span className="text-sm">{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/iris")}>
                      <Link to="/iris" className="flex items-center gap-2 font-bold text-purple-600">
                        <ShieldCheck className="h-4 w-4 text-purple-600" />
                        {!collapsed && <span>Iris</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Análisis</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {analisisPrincipales.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setDetallesOpen((v) => !v)} className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">Detalles contables</span>
                        {detallesOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {detallesOpen &&
                  analisisDetalles.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-7"}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}

                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setEnConstruccionOpen((v) => !v)} className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">En construcción</span>
                        {enConstruccionOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {enConstruccionOpen &&
                  analisisEnConstruccion.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} className={collapsed ? "" : "pl-7"}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                {
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={isActive("/analisis-ai")}>
                      <Link to="/analisis-ai" className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        {!collapsed && <span>Análisis AI</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                }
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t">
        {!collapsed && <div className="px-2 py-2 text-xs text-muted-foreground truncate">{user?.email}</div>}
        <Button variant="ghost" size="sm" onClick={() => signOut()} className="justify-start">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Salir</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
