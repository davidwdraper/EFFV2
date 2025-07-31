'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getAct } from '../../services/actService';
import { getUser } from '../../services/userService';
import { getUserActsForAct, deleteUserAct } from '../../services/userActService';
import { useAuth } from '../../utils/auth';
import { Act } from '../../../shared/interfaces/Act';
import { User } from '../../../shared/interfaces/User';
import { UserAct } from '../../../shared/interfaces/UserAct';

export default function ActDetail() {
  const { id } = useParams();
  const [act, setAct] = useState<Act | null>(null);
  const [userActs, setUserActs] = useState<UserAct[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const { currentUser, isAdmin } = useAuth();

  useEffect(() => {
    if (id) {
      getAct(id as string).then(setAct);
      getUserActsForAct(id as string).then(setUserActs);
    }
  }, [id]);

  useEffect(() => {
    const fetchUsers = async () => {
      const results = await Promise.all(userActs.map(ua => getUser(ua.userId)));
      setUsers(results);
    };
    if (userActs.length > 0) fetchUsers();
    else setUsers([]);
  }, [userActs]);

  if (!act) return <p>Loading...</p>;

  const canEdit = currentUser && (isAdmin || currentUser._id === act.userOwnerId);

  const handleRemove = async (userId: string) => {
    await deleteUserAct(act.actId, userId);
    setUserActs(prev => prev.filter(ua => ua.userId !== userId));
  };

  return (
    <main>
      <h1>{act.name}</h1>
      <p>Email: {act.eMailAddr}</p>
      {act.imageIds && act.imageIds.length > 0 && (
        <img src={`/images/${act.imageIds[0]}`} alt="act preview" width={100} />
      )}

      {canEdit && (
        <div>
          <button>Edit</button>
          <button>Delete</button>
        </div>
      )}

      <section>
        <h2>Members</h2>
        <ul>
          {users.map(user => (
            <li key={user.userId}>
              {user.name}
              {canEdit && (
                <button onClick={() => handleRemove(user.userId)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
