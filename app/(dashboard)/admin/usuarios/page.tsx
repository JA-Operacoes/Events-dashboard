"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui";
import { notifySuccess, notifyError, confirmDanger, showDetails } from "@/lib/swal";
import { PASSWORD_HINT } from "@/lib/passwordPolicy";

type EventWithEditions = {
  id: string;
  nome: string;
  editions: { id: string; label: string; ano: number }[];
};
type Role = "admin" | "funcionario" | "usuario";
type UserRow = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  editionAccess: { edition: { id: string; label: string; ano: number; event: { id: string; nome: string } } }[];
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", funcionario: "Funcionário", usuario: "Usuário" };
const ROLE_BADGE_CLASS: Record<Role, string> = { admin: "pago", funcionario: "pendente", usuario: "cancelado" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function groupByEvent(u: UserRow): Map<string, string[]> {
  const byEvent = new Map<string, string[]>();
  for (const a of u.editionAccess) {
    const key = a.edition.event.nome;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key)!.push(a.edition.label);
  }
  return byEvent;
}

/**
 * Coluna "Edições" da tabela — com 3 ou menos, mostra "Evento (n)" por
 * extenso mesmo (cabe numa linha). A partir de 4, listar tudo vira ilegível
 * — mostra só o total e abre um popup com a lista completa ao clicar.
 */
function EditionAccessCell({ u }: { u: UserRow }) {
  if (u.role === "admin") return <>todas</>;
  if (!u.editionAccess.length) return <>—</>;

  const byEvent = groupByEvent(u);

  if (u.editionAccess.length <= 3) {
    return <>{Array.from(byEvent, ([nome, labels]) => `${nome} (${labels.length})`).join(", ")}</>;
  }

  function openDetails() {
    const html = Array.from(byEvent, ([nome, labels]) => `<strong>${escapeHtml(nome)}</strong>: ${labels.map(escapeHtml).join(", ")}`).join(
      "<br/>"
    );
    showDetails(`Edições de ${u.email}`, html);
  }

  return (
    <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={openDetails}>
      {u.editionAccess.length} edições
    </button>
  );
}

/**
 * admin: acesso total. funcionario: mexe nos dados (import/sync/KPI) das
 * edições vinculadas, mas não entra em Eventos/Usuários. usuario: só olha.
 */
function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="pref-seg" style={{ padding: 2, alignSelf: "flex-start" }}>
      {(["usuario", "funcionario", "admin"] as const).map((r) => (
        <button key={r} type="button" className={value === r ? "on" : ""} onClick={() => onChange(r)}>
          {ROLE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/**
 * Acesso é concedido por EDIÇÃO, não por evento inteiro — dar acesso ao
 * evento todo confundia quem via edições antigas/irrelevantes misturadas às
 * atuais. Com muitos eventos/edições, listar tudo expandido vira uma parede
 * de texto — por isso cada evento é um accordion fechado por padrão (só abre
 * sozinho se já tiver alguma edição selecionada), com o total marcado no
 * cabeçalho pra dar pra ver de relance sem precisar abrir.
 */
function EditionPicker({
  events,
  selected,
  onToggle,
}: {
  events: EventWithEditions[];
  selected: Set<string>;
  onToggle: (editionId: string) => void;
}) {
  const withEditions = events.filter((ev) => ev.editions.length > 0);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(withEditions.filter((ev) => ev.editions.some((ed) => selected.has(ed.id))).map((ev) => ev.id))
  );

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!withEditions.length) {
    return (
      <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
        nenhum evento com edição cadastrada ainda — crie um em Eventos antes
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
      {withEditions.map((ev, i) => {
        const count = ev.editions.filter((ed) => selected.has(ed.id)).length;
        const isOpen = openIds.has(ev.id);
        return (
          <div key={ev.id} style={{ borderTop: i > 0 ? "1px solid var(--line)" : "none" }}>
            <button
              type="button"
              onClick={() => toggleOpen(ev.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-dim)" }}>{ev.nome}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: count ? "var(--accent)" : "var(--ink-mute)" }}>
                  {count}/{ev.editions.length}
                </span>
                <span style={{ fontSize: 10, color: "var(--ink-mute)" }}>{isOpen ? "▾" : "▸"}</span>
              </span>
            </button>
            {isOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 10px 10px" }}>
                {ev.editions.map((ed) => (
                  <div key={ed.id} className="pref-seg" style={{ padding: "5px 10px" }}>
                    <Checkbox checked={selected.has(ed.id)} onChange={() => onToggle(ed.id)} label={ed.label} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditUserRow({
  user,
  events,
  onCancel,
  onSaved,
}: {
  user: UserRow;
  events: EventWithEditions[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user.role);
  const [selectedEditions, setSelectedEditions] = useState<Set<string>>(
    new Set(user.editionAccess.map((a) => a.edition.id))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleEdition(id: string) {
    setSelectedEditions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: password || undefined,
        role,
        editionIds: role === "admin" ? [] : Array.from(selectedEditions),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const msg = (await res.json()).error ?? "Falha ao salvar";
      setError(msg);
      notifyError("Não foi possível salvar", msg);
      return;
    }
    notifySuccess("Usuário atualizado");
    onSaved();
  }

  return (
    <tr>
      <td colSpan={4} style={{ padding: 0 }}>
        <div className="panel" style={{ margin: "8px 10px", border: "1px solid var(--accent)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                placeholder="e-mail"
              />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  style={{ width: "100%" }}
                  placeholder="nova senha (deixe em branco para manter a atual)"
                  minLength={8}
                />
                {password && <small style={{ fontSize: 11, color: "var(--ink-mute)" }}>{PASSWORD_HINT}</small>}
              </div>
            </div>

            <div>
              <p className="section-label" style={{ margin: "0 0 8px" }}>
                Perfil
              </p>
              <RoleSelect value={role} onChange={setRole} />
              <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
                {role === "admin" && "Acesso total — gerencia eventos, edições e outros usuários, enxerga tudo."}
                {role === "funcionario" && "Importa planilha, sincroniza e edita KPI nas edições vinculadas — sem acesso a Eventos/Usuários."}
                {role === "usuario" && "Só visualiza as edições vinculadas, sem mexer em nada."}
              </p>
            </div>

            {role !== "admin" && (
              <div>
                <p className="section-label" style={{ margin: "0 0 8px" }}>
                  Edições que este usuário acessa
                </p>
                <EditionPicker events={events} selected={selectedEditions} onToggle={toggleEdition} />
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" type="button" disabled={saving} onClick={handleSave}>
                {saving ? "Salvando…" : "Salvar"}
              </button>
              <button className="btn" type="button" onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function AdminUsuariosPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [events, setEvents] = useState<EventWithEditions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [novoRole, setNovoRole] = useState<Role>("usuario");
  const [selectedEditions, setSelectedEditions] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [usersRes, eventsRes] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/events")]);
    setUsers(await usersRes.json());
    const eventsData = await eventsRes.json();
    setEvents(
      eventsData.map((e: any) => ({
        id: e.id,
        nome: e.nome,
        editions: e.editions.map((ed: any) => ({ id: ed.id, label: ed.label, ano: ed.ano })),
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function toggleEdition(id: string) {
    setSelectedEditions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        role: novoRole,
        editionIds: novoRole === "admin" ? [] : Array.from(selectedEditions),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const msg = (await res.json()).error ?? "Falha ao criar usuário";
      setError(msg);
      notifyError("Não foi possível criar o usuário", msg);
      return;
    }
    setEmail("");
    setPassword("");
    setNovoRole("usuario");
    setSelectedEditions(new Set());
    load();
    notifySuccess("Usuário criado");
  }

  const filteredUsers = users.filter((u) => u.email.toLowerCase().includes(userSearch.trim().toLowerCase()));

  async function handleDelete(id: string) {
    const ok = await confirmDanger("Remover este usuário?", "O acesso dele a todas as edições vinculadas também é removido — não dá pra desfazer.");
    if (!ok) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    load();
    notifySuccess("Usuário removido");
  }

  if (!isAdmin) {
    return (
      <div className="empty" style={{ marginTop: 40 }}>
        <div className="g">⌸</div>
        <strong>Acesso restrito</strong>
        <span>Esta área é só para administradores.</span>
      </div>
    );
  }

  return (
    <>
      <div className="topline">
        <div>
          <h1>Usuários</h1>
          <div className="sub">cadastro rápido — vincula direto às edições que a pessoa vai acessar</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <div>
            <h3>Novo usuário</h3>
            <p>defina a senha inicial da pessoa — se ela esquecer, edite o usuário na lista abaixo para trocar</p>
          </div>
        </div>
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="email"
              placeholder="e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              style={{ flex: 1 }}
            />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                type="text"
                placeholder="senha inicial"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="input"
                style={{ width: "100%" }}
              />
              <small style={{ fontSize: 11, color: "var(--ink-mute)" }}>{PASSWORD_HINT}</small>
            </div>
          </div>

          <div>
            <p className="section-label" style={{ margin: "0 0 8px" }}>
              Perfil
            </p>
            <RoleSelect value={novoRole} onChange={setNovoRole} />
            <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "6px 0 0" }}>
              {novoRole === "admin" && "Acesso total — gerencia eventos, edições e outros usuários, enxerga tudo."}
              {novoRole === "funcionario" && "Importa planilha, sincroniza e edita KPI nas edições vinculadas — sem acesso a Eventos/Usuários."}
              {novoRole === "usuario" && "Só visualiza as edições vinculadas, sem mexer em nada."}
            </p>
          </div>

          {novoRole !== "admin" && (
            <div>
              <p className="section-label" style={{ margin: "0 0 8px" }}>
                Edições que este usuário vai acessar
              </p>
              <EditionPicker events={events} selected={selectedEditions} onToggle={toggleEdition} />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button className="btn primary" type="submit" disabled={submitting} style={{ alignSelf: "flex-start" }}>
            {submitting ? "Criando…" : "Criar usuário"}
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <div className="panel-head" style={{ padding: "16px 16px 0" }}>
          <div>
            <h3>Usuários cadastrados</h3>
          </div>
          <div className="search" style={{ maxWidth: 260 }}>
            <input
              type="text"
              placeholder="Buscar por e-mail"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Edições</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)" }}>
                    carregando…
                  </td>
                </tr>
              ) : !users.length ? (
                <tr>
                  <td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)" }}>
                    nenhum usuário cadastrado ainda
                  </td>
                </tr>
              ) : !filteredUsers.length ? (
                <tr>
                  <td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--ink-mute)" }}>
                    nenhum resultado para "{userSearch}"
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) =>
                  editingId === u.id ? (
                    <EditUserRow
                      key={u.id}
                      user={u}
                      events={events}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        load();
                      }}
                    />
                  ) : (
                    <tr key={u.id}>
                      <td style={{ fontFamily: "var(--sans)", color: "var(--ink)" }}>{u.email}</td>
                      <td>
                        <span className={`badge ${ROLE_BADGE_CLASS[u.role]}`}>
                          <span className="dot" />
                          {ROLE_LABEL[u.role]}
                        </span>
                      </td>
                      <td>
                        <EditionAccessCell u={u} />
                      </td>
                      <td style={{ display: "flex", gap: 8 }}>
                        <button className="btn" type="button" onClick={() => setEditingId(u.id)}>
                          Editar
                        </button>
                        <button className="btn" type="button" onClick={() => handleDelete(u.id)}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
