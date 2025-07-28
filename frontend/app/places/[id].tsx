'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getPlace } from '../../services/placeService';
import { useAuth } from '../../utils/auth';
import { Place } from '../../../shared/interfaces/Place';

export default function PlaceDetail() {
  const { id } = useParams();
  const [place, setPlace] = useState<Place | null>(null);
  const { currentUser, isAdmin } = useAuth();

  useEffect(() => {
    if (id) getPlace(id as string).then(setPlace);
  }, [id]);

  if (!place) return <p>Loading...</p>;

  const canEdit = currentUser && (isAdmin || currentUser.userId === place.userOwnerId);

  return (
    <main>
      <h1>{place.name}</h1>
      <p>{place.addr1}, {place.city}, {place.state}, {place.zip}</p>
      <p>Email: {place.eMailAddr}</p>
      <div style={{ height: '300px', width: '100%', background: '#ccc' }}>
        {/* Replace with actual Google Map later */}
        <p>Map placeholder: ({place.lat}, {place.lng})</p>
      </div>
      {canEdit && (
        <div>
          <button>Edit</button>
          <button>Delete</button>
        </div>
      )}
    </main>
  );
}
