import { useEffect, useState } from 'react';

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const stored = localStorage.getItem('jwtUser');
    if (stored) {
      setCurrentUser(JSON.parse(stored));
    }
  }, []);

  const isAdmin = currentUser?.userType >= 3;
  const isSelf = (userId: string) => currentUser?.userId === userId;

  return { currentUser, isAdmin, isSelf };
}
