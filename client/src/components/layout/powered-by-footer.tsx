import vrtSyncLogo from "@assets/FINAL-02_1754876518960.png";

export default function PoweredByFooter() {
  return (
    <div className="w-full bg-black/30 backdrop-blur-sm border-t border-white/10 py-4 px-6">
      <div className="flex items-center justify-center space-x-3">
        <span className="text-sm text-white/90">Powered by</span>
        <img 
          src={vrtSyncLogo} 
          alt="VRTSync" 
          className="h-8 w-auto"
        />
      </div>
    </div>
  );
}