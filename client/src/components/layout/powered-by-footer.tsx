import vrtSyncLogo from "@assets/FINAL-02_1754876079512.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-gray-50 border-t border-gray-200 py-8 px-6">
      <div className="flex items-center justify-center space-x-4">
        <span className="text-lg text-gray-600 font-medium">Powered by</span>
        <img 
          src={vrtSyncLogo} 
          alt="VRTSync" 
          className="h-16 w-auto"
        />
      </div>
    </div>
  );
}