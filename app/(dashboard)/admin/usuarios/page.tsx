"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

type EventOption = { id: string; nome: string };
type UserRow = {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: string;
  eventAccess: { event: { id: string; nome: string } }[];
};

function EditUserRow({
  user,
  events,
  onCancel,
  onSaved,
}: {
  user: UserRow;
  events: EventOption[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(
    new Set(user.eventAccess.map((a) => a.event.id))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleEvent(id: string) {
    setSelectedEvents((prev) => {
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
        isAdmin,
        eventIds: isAdmin ? [] : Array.from(selectedEvents),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao salvar");
      return;
    }
    onSaved();
  }

  return (
    <tr>
      <td colSpan={4} style={{ padding: 0 }}>
        <div className="panel" style={{ margin: "8px 10px", border: "1px solid var(--accent)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                placeholder="e-mail"
              />
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                style={{ flex: 1 }}
                placeholder="nova senha (deixe em branco para manter a atual)"
                minLength={8}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-dim)" }}>
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
              é administrador (enxerga todos os eventos, sem precisar vincular)
            </label>

            {!isAdmin && (
              <div>
                <p className="section-label" style={{ margin: "0 0 8px" }}>
                  Eventos que este usuário acessa
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {events.map((ev) => (
                    <label
                      key={ev.id}
                      className="pref-seg"
                      style={{ padding: "6px 12px", cursor: "pointer", gap: 6, display: "flex", alignItems: "center" }}
                    >
                      <input type="checkbox" checked={selectedEvents.has(ev.id)} onChange={() => toggleEvent(ev.id)} />
                      <span style={{ fontSize: 12.5 }}>{ev.nome}</span>
                    </label>
                  ))}
                </div>
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
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [novoAdmin, setNovoAdmin] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    const [usersRes, eventsRes] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/events")]);
    setUsers(await usersRes.json());
    setEvents((await eventsRes.json()).map((e: any) => ({ id: e.id, nome: e.nome })));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function toggleEvent(id: string) {
    setSelectedEvents((prev) => {
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
        isAdmin: novoAdmin,
        eventIds: novoAdmin ? [] : Array.from(selectedEvents),
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao criar usuário");
      return;
    }
    setEmail("");
    setPassword("");
    setNovoAdmin(false);
    setSelectedEvents(new Set());
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este usuário?")) return;
    await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    load();
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
          <div className="sub">cadastro rápido — vincula direto aos eventos que a pessoa vai acessar</div>
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
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="email"
              placeholder="e-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              style={{ flex: 1 }}
            />
            <input
              type="text"
              placeholder="senha inicial (mín. 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="input"
              style={{ flex: 1 }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-dim)" }}>
            <input type="checkbox" checked={novoAdmin} onChange={(e) => setNovoAdmin(e.target.checked)} />
            é administrador (enxerga todos os eventos, sem precisar vincular)
          </label>

          {!novoAdmin && (
            <div>
              <p className="section-label" style={{ margin: "0 0 8px" }}>
                Eventos que este usuário vai acessar
              </p>
              {!events.length ? (
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  nenhum evento cadastrado ainda — crie um em Eventos antes
                </span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {events.map((ev) => (
                    <label
                      key={ev.id}
                      className="pref-seg"
                      style={{ padding: "6px 12px", cursor: "pointer", gap: 6, display: "flex", alignItems: "center" }}
                    >
                      <input type="checkbox" checked={selectedEvents.has(ev.id)} onChange={() => toggleEvent(ev.id)} />
                      <span style={{ fontSize: 12.5 }}>{ev.nome}</span>
                    </label>
                  ))}
                </div>
              )}
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
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Eventos</th>
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
              ) : (
                users.map((u) =>
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
                        <span className={`badge ${u.isAdmin ? "pago" : "pendente"}`}>
                          <span className="dot" />
                          {u.isAdmin ? "Admin" : "Usuário"}
                        </span>
                      </td>
                      <td>{u.isAdmin ? "todos" : u.eventAccess.map((a) => a.event.nome).join(", ") || "—"}</td>
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
