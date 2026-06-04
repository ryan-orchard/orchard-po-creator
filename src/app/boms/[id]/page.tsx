"use client";

import { useState, useEffect, use } from "react";
import BomForm from "../BomForm";

interface BomDetail {
  finishedGoodId: string;
  finishedGoodSku: string;
  finishedGoodName: string;
  uom: string;
  components: { componentId: string; componentSku: string; qtyPerOutput: number }[];
}

export default function EditBomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [bom, setBom] = useState<BomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/boms/${id}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => {
        if (data) { setBom(data); setLoading(false); }
      });
  }, [id]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  );

  if (notFound || !bom) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-500">BOM not found.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Edit BOM</h1>
          <p className="text-sm text-gray-500 mt-1">
            {bom.finishedGoodSku} — {bom.finishedGoodName}
          </p>
        </div>
        <BomForm
          initialFinishedGoodId={bom.finishedGoodId}
          initialComponents={bom.components.map((c) => ({
            componentId: c.componentId,
            qtyPerOutput: c.qtyPerOutput,
          }))}
          lockFinishedGood
        />
      </div>
    </div>
  );
}
