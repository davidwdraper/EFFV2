"use client";
import { useEffect, useState } from "react";
import { getUser } from "../../services/userService";
import { useAuth } from "../../utils/auth";
import { useParams } from "next/navigation";
import { User } from "../../../shared/interfaces/User";

export default function UserDetail() {
  const { id } = useParams();
  const { currentUser, isAdmin, isSelf } = useAuth();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (id) {
      getUser(id as string).then(setUser);
    }
  }, [id]);

  if (!user) return <p>Loading...</p>;

  const canEdit = currentUser && (isAdmin || isSelf(user.userId));
  const showFull = canEdit;

  return (
    <main>
      <h1>{user.name}</h1>
      {user.imageIds && user.imageIds.length > 0 && (
        <img src={`/images/${user.imageIds[0]}`} alt="profile" width={100} />
      )}
      {showFull ? (
        <div>
          <p>Email: {user.email}</p>
          <p>Bio: {user.bio}</p>
          {/* Editable form goes here */}
        </div>
      ) : (
        <p>Only limited information is available.</p>
      )}
    </main>
  );
}
