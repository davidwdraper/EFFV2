"use client";
import { useState, useEffect } from "react";
import { searchUsers } from "../../services/userService";
import Link from "next/link";
import { User } from "../../../shared/interfaces/User";

export default function UserList() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    if (query.length >= 3) {
      const timeoutId = setTimeout(() => {
        searchUsers(query).then(setUsers);
      }, 300);
      return () => clearTimeout(timeoutId);
    } else {
      setUsers([]);
    }
  }, [query]);

  return (
    <main>
      <h1>Search Users</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
      />
      <ul>
        {users.map((user: User) => (
          <li key={user.userId}>
            <Link href={`/users/${user.userId}`}>
              <div>
                <strong>{user.name}</strong>
                {user.imageIds && user.imageIds.length > 0 && (
                  <img
                    src={`/images/${user.imageIds[0]}`}
                    alt="profile"
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
