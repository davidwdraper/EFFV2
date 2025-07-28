'use client';
import { useEffect, useState } from 'react';
import { getAllPlaces } from '../../services/placeService';
import Link from 'next/link';
import { Place } from '../../../shared/interfaces/Place';

export default function PlaceList() {
  const [places, setPlaces] = useState<Place[]>([]);

  useEffect(() => {
    getAllPlaces().then(setPlaces);
  }, []);

  return (
    <main>
      <h1>Places</h1>
      <ul>
        {places.map(place => (
          <li key={place.placeId}>
            <Link href={`/places/${place.placeId}`}>
              <div>
                <strong>{place.name}</strong> ({place.lat}, {place.lng})
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
