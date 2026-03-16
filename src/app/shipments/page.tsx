"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Shipment {
  id: string;
  shipmentNumber: string;
  purchaseOrder: string[];
  shipDate: string;
  expectedDeliveryDate: string;
  carrier: string;
  status: string;
  shipTo: string[];
}

interface POInfo {
  id: string;
  poNumber: string;
  supplier: string[];
}

interface Location {
  id: string;
  name: string;
}

const STATUS_TABS = ["All", "Created", "In Transit", "Delivered"] as const;

const statusColors: Record<string, string> = {
  Created: "bg-yellow-100 text-yellow-800",
  "In Transit": "bg-blue-100 text-blue-800",
  Delivered: "bg-green-100 text-green-800",
};

export default function ShipmentsListPage() {
  const router = useRouter();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [poMap, setPOMap] = useState<Record<string, string>>({});
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("All");

  useEffect(() => {
    Promise.all([
      fetch("/api/shipments").then((r) => r.json()),
      fetch("/api/purchase-orders").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
    ]).then(([shipmentData, poData, locationData]) => {
      setShipments(shipmentData);
      const pMap: Record<string, string> = {};
      poData.forEach((p: POInfo) => {
        pMap[p.id] = p.poNumber;
      });
      setPOMap(pMap);
      const lMap: Record<string, string> = {};
      locationData.forEach((l: Location) => {
        lMap[l.id] = l.name;
      });
      setLocationMap(lMap);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (shipmentId: string, shipmentNumber: string) => {
    if (!confirm(`Delete ${shipmentNumber}? This cannot be undone.`)) return;
    setDeleting(shipmentId);
    try {
      await fetch(`/api/shipments/${shipmentId}`, { method: "DELETE" });
      setShipments((prev) => prev.filter((s) => s.id !== shipmentId));
    } catch {
      alert("Error deleting shipment. Please try again.");
    } finally {
      setDeleting(null);
    }
  };

  const filteredShipments = activeTab === "All"
    ? shipments
    : shipments.filter((s) => s.status === activeTab);

  const tabCounts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab] = tab === "All" ? shipments.length : shipments.filter((s) => s.status === tab).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shipments</h1>
            <p className="text-sm text-gray-500 mt-1">
              {shipments.length} {shipments.length === 1 ? "shipment" : "shipments"}
            </p>
          </div>
          <button
            onClick={() => router.push("/shipments/new")}
            className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
          >
            + Create Shipment
          </button>
        </div>

        {/* Status tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab}
              <span className={`ml-1.5 text-xs ${activeTab === tab ? "text-gray-600" : "text-gray-400"}`}>
                {tabCounts[tab]}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : filteredShipments.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500 mb-4">
              {activeTab === "All" ? "No shipments yet." : `No ${activeTab.toLowerCase()} shipments.`}
            </p>
            {activeTab === "All" && (
              <button
                onClick={() => router.push("/shipments/new")}
                className="bg-gray-900 text-white px-4 py-2 text-sm rounded-md hover:bg-gray-800"
              >
                Create your first shipment
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Shipment #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    PO #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Ship To
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Ship Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    ETA
                  </th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredShipments.map((shipment) => (
                  <tr
                    key={shipment.id}
                    onClick={() => router.push(`/shipments/${shipment.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {shipment.shipmentNumber}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600">
                      {shipment.purchaseOrder?.[0] ? poMap[shipment.purchaseOrder[0]] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[shipment.status] || "bg-gray-100 text-gray-600"}`}
                      >
                        {shipment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {shipment.shipTo?.[0] ? locationMap[shipment.shipTo[0]] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {shipment.shipDate
                        ? new Date(shipment.shipDate + "T00:00:00").toLocaleDateString("en-US")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {shipment.expectedDeliveryDate
                        ? new Date(shipment.expectedDeliveryDate + "T00:00:00").toLocaleDateString("en-US")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(shipment.id, shipment.shipmentNumber)}
                        disabled={deleting === shipment.id}
                        className="text-red-300 hover:text-red-500 disabled:opacity-50 p-1"
                        title="Delete shipment"
                      >
                        {deleting === shipment.id ? (
                          <span className="text-xs">...</span>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
