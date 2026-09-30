// Append-only audit trail. Called inside the same transaction as the change it describes,
// so the log can never disagree with the data.
export async function recordEvent(db, { entityType, entityId, from = null, to, actorId = null, metadata = {} }) {
  await db.query(
    `INSERT INTO ride_events (entity_type, entity_id, from_status, to_status, actor_user_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entityType, entityId, from, to, actorId, JSON.stringify(metadata)],
  );
}

export async function listEvents(db, entityType, entityId) {
  const { rows } = await db.query(
    `SELECT e.from_status, e.to_status, e.metadata, e.created_at, u.name AS actor_name, u.role AS actor_role
       FROM ride_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.entity_type = $1 AND e.entity_id = $2 ORDER BY e.id`,
    [entityType, entityId],
  );
  return rows.map((r) => ({
    from: r.from_status,
    to: r.to_status,
    at: r.created_at,
    actor: r.actor_name ? { name: r.actor_name, role: r.actor_role } : null,
    metadata: r.metadata,
  }));
}
