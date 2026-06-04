import BomForm from "../BomForm";

export default function NewBomPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">New Bill of Materials</h1>
          <p className="text-sm text-gray-500 mt-1">Define the components that go into producing one unit of a finished good.</p>
        </div>
        <BomForm />
      </div>
    </div>
  );
}
