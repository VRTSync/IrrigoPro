import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Wrench, Package } from "lucide-react";
import { EstimatesManager } from "@/components/manager/estimates-manager";
import { WorkOrdersManager } from "@/components/manager/work-orders-manager";
import { PartsListManager } from "@/components/manager/parts-list-manager";

type ManagerView = 'menu' | 'estimates' | 'work-orders' | 'parts';

export default function ManagerDashboard() {
  const [currentView, setCurrentView] = useState<ManagerView>('menu');

  const renderContent = () => {
    switch (currentView) {
      case 'estimates':
        return <EstimatesManager onBack={() => setCurrentView('menu')} />;
      case 'work-orders':
        return <WorkOrdersManager onBack={() => setCurrentView('menu')} />;
      case 'parts':
        return <PartsListManager onBack={() => setCurrentView('menu')} />;
      default:
        return (
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900">Manager Dashboard</h1>
              <p className="text-gray-600 mt-2">Choose an option to get started</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Estimates */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('estimates')}>
                <CardHeader className="text-center">
                  <div className="bg-blue-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <FileText className="w-8 h-8 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl">Estimates</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-gray-600 mb-4">View estimate list, create new estimates, and convert to work orders</p>
                  <Button className="w-full bg-blue-600 hover:bg-blue-700">
                    Manage Estimates
                  </Button>
                </CardContent>
              </Card>

              {/* Work Orders */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('work-orders')}>
                <CardHeader className="text-center">
                  <div className="bg-green-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Wrench className="w-8 h-8 text-green-600" />
                  </div>
                  <CardTitle className="text-xl">Work Orders</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-gray-600 mb-4">View work order list, create new orders, and assign to technicians</p>
                  <Button className="w-full bg-green-600 hover:bg-green-700">
                    Manage Work Orders
                  </Button>
                </CardContent>
              </Card>

              {/* Parts List */}
              <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => setCurrentView('parts')}>
                <CardHeader className="text-center">
                  <div className="bg-purple-100 p-4 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Package className="w-8 h-8 text-purple-600" />
                  </div>
                  <CardTitle className="text-xl">Parts List</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-gray-600 mb-4">View parts inventory without pricing information</p>
                  <Button className="w-full bg-purple-600 hover:bg-purple-700">
                    View Parts
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {renderContent()}
    </div>
  );
}