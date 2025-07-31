"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getEvent } from "../../services/eventService";
import { getAct } from "../../services/actService";
import {
  getEventActsForEvent,
  deleteEventAct,
} from "../../services/eventActService";
import { useAuth } from "../../utils/auth";
import { Event } from "../../../shared/interfaces/Event";
import { Act } from "../../../shared/interfaces/Act";
import { EventAct } from "../../../shared/interfaces/EventAct";

export default function EventDetail() {
  const { id } = useParams();
  const [event, setEvent] = useState<Event | null>(null);
  const [eventActs, setEventActs] = useState<EventAct[]>([]);
  const [acts, setActs] = useState<Act[]>([]);
  const { currentUser, isAdmin } = useAuth();

  useEffect(() => {
    if (id) {
      getEvent(id as string).then(setEvent);
      getEventActsForEvent(id as string).then(setEventActs);
    }
  }, [id]);

  useEffect(() => {
    const fetchActs = async () => {
      const results = await Promise.all(
        eventActs.map((ea) => getAct(ea.actId))
      );
      setActs(results);
    };
    if (eventActs.length > 0) fetchActs();
    else setActs([]);
  }, [eventActs]);

  if (!event) return <p>Loading...</p>;

  const canEdit =
    currentUser && (isAdmin || currentUser._id === event.userOwnerId);

  const handleRemove = async (actId: string) => {
    await deleteEventAct(event.eventId, actId);
    setEventActs((prev) => prev.filter((ea) => ea.actId !== actId));
  };

  return (
    <main>
      <h1>{event.name}</h1>
      <p>{event.comments}</p>
      <p>
        {new Date(event.startDateTime).toLocaleString()} –{" "}
        {new Date(event.endDateTime).toLocaleString()}
      </p>
      {event.imageIds && event.imageIds.length > 0 && (
        <img
          src={`/images/${event.imageIds[0]}`}
          alt="event preview"
          width={100}
        />
      )}
      {canEdit && (
        <div>
          <button>Edit</button>
          <button>Delete</button>
        </div>
      )}

      <section>
        <h2>Linked Acts</h2>
        <ul>
          {acts.map((act) => (
            <li key={act.actId}>
              {act.name}
              {canEdit && (
                <button onClick={() => handleRemove(act.actId)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
