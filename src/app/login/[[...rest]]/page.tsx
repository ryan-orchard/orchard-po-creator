import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <div className="flex flex-col items-center gap-4">
        <div className="text-center mb-2">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Orchard Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Sign in to continue</p>
        </div>

        <SignIn
          routing="path"
          path="/login"
          fallbackRedirectUrl="/dashboard"
          appearance={{
            variables: {
              colorBackground: "#ffffff",
              colorPrimary: "#3d4a3d",
              colorText: "#2c2c2c",
              colorTextSecondary: "#9ca3af",
              colorInputBackground: "#ffffff",
              borderRadius: "0.5rem",
              fontFamily: "inherit",
              fontSize: "14px",
            },
            elements: {
              card: {
                boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.08)",
                border: "1px solid #e5e7eb",
              },
              headerTitle: { display: "none" },
              headerSubtitle: { display: "none" },
            },
          }}
        />

        <p className="text-[11px] text-gray-400 mt-2">
          Powered by <span className="font-semibold text-gray-500">Orchard</span>
        </p>
      </div>
    </div>
  );
}
