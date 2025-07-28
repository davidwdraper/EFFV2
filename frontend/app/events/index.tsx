"use client";
import { useEffect, useState } from "react";
import { getAllEvents } from "../../services/eventService";
import Link from "next/link";
import { Event } from "../../../shared/interfaces/Event";

export default function EventList() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    getAllEvents().then(setEvents);
  }, []);

  return (
    <main>
      <h1>Events</h1>
      <ul>
        {events.map((event) => (
          <li key={event.eventId}>
            <Link href={`/events/${event.eventId}`}>
              <div>
                <strong>{event.name}</strong>
                <br />
                {new Date(event.startDateTime).toLocaleString()} -{" "}
                {new Date(event.endDateTime).toLocaleString()}
                {event.imageIds && event.imageIds.length > 0 && (
                  <div>
                    <img
                      src={`/images/${event.imageIds[0]}`}
                      alt="event preview"
                      width={50}
                    />
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
