'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import type { Category, Complaint } from '@/src/lib/types';

const defaultCenter: [number, number] = [12.9716, 77.5946];

function FitBounds({ complaints }: { complaints: Complaint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!complaints.length) return;
    const bounds = L.latLngBounds(complaints.map((complaint) => [complaint.latitude, complaint.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }, [complaints, map]);
  return null;
}

function markerColor(complaint: Complaint) {
  if (complaint.severity === 'CRITICAL') return '#b42318';
  if (complaint.severity === 'HIGH') return '#f79009';
  if (complaint.status === 'CLOSED' || complaint.status === 'RESOLVED') return '#067647';
  return '#155eef';
}

function clusterKey(complaint: Complaint) {
  return `${complaint.latitude.toFixed(2)}:${complaint.longitude.toFixed(2)}`;
}

export default function CivicMap({ complaints, categories, onOpenComplaint }: { complaints: Complaint[]; categories: Category[]; onOpenComplaint: (complaint: Complaint) => void }) {
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const mappable = complaints.filter((complaint) => Number.isFinite(complaint.latitude) && Number.isFinite(complaint.longitude) && Math.abs(complaint.latitude) <= 90 && Math.abs(complaint.longitude) <= 180);
  const clusters = useMemo(() => {
    const groups = new Map<string, Complaint[]>();
    for (const complaint of mappable) groups.set(clusterKey(complaint), [...(groups.get(clusterKey(complaint)) ?? []), complaint]);
    return [...groups.values()];
  }, [mappable]);

  return <div className="map-shell">
    <MapContainer center={defaultCenter} zoom={12} scrollWheelZoom className="civic-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds complaints={mappable} />
      {clusters.map((cluster) => {
        const first = cluster[0];
        const center: [number, number] = cluster.length === 1 ? [first.latitude, first.longitude] : [cluster.reduce((sum, item) => sum + item.latitude, 0) / cluster.length, cluster.reduce((sum, item) => sum + item.longitude, 0) / cluster.length];
        const color = markerColor(first);
        return <CircleMarker key={cluster.map((item) => item.id).join('-')} center={center} radius={cluster.length === 1 ? 9 : Math.min(24, 11 + cluster.length)} pathOptions={{ color, fillColor: color, fillOpacity: 0.82, weight: 2 }}>
          <Popup>
            <div className="map-popup">
              {cluster.length > 1 && <strong>{cluster.length} nearby complaints</strong>}
              {cluster.length === 1 ? <>
                <strong>{first.title}</strong><span>{categoryNames.get(first.category_id) ?? 'Other'} · {first.severity}</span><span>{first.status.replaceAll('_', ' ')}</span><small>{first.address || 'Approximate location available'}</small><button onClick={() => onOpenComplaint(first)}>View complaint</button>
              </> : <div className="map-cluster-list">{cluster.slice(0, 8).map((complaint) => <button key={complaint.id} onClick={() => onOpenComplaint(complaint)}><span>{complaint.title}</span><small>{complaint.status.replaceAll('_', ' ')} · {complaint.severity}</small></button>)}{cluster.length > 8 && <small>Showing the first 8 nearby complaints.</small>}</div>}
            </div>
          </Popup>
        </CircleMarker>;
      })}
    </MapContainer>
    {!mappable.length && <div className="map-empty">No authorized complaints with valid coordinates match the current filters.</div>}
  </div>;
}
