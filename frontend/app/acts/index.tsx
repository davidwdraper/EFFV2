"use client";
import { useEffect, useState } from "react";
import { getAllActs } from "../../services/actService";
import Link from "next/link";
import { Act } from "../../../shared/interfaces/Act";

export default function ActList() {
  const [acts, setActs] = useState<Act[]>([]);

  useEffect(() => {
    getAllActs().then(setActs);
  }, []);

  return (
    <main>
      <h1>Acts</h1>
      <ul>
        {acts.map((act) => (
          <li key={act.actId}>
            <Link href={`/acts/${act.actId}`}>
              <div>
                <strong>{act.name}</strong>
                {act.imageIds && act.imageIds.length > 0 && (
                  <img
                    src={`/images/${act.imageIds[0]}`}
                    alt="act preview"
                    width={50}
                  />
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
