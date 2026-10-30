import type { SourceFile } from '../lib/types';
export const demoFiles: SourceFile[] = [
  {
    path: 'api/Orders.Api.csproj',
    content: `<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../domain/Orders.Domain.csproj" /></ItemGroup></Project>`,
  },
  {
    path: 'domain/Orders.Domain.csproj',
    content: `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`,
  },
  {
    path: 'api/OrdersController.cs',
    content: `using Orders.Domain;
namespace Orders.Api;
public class OrdersController
{
    private OrderService service;
    public OrdersController(OrderService service) { this.service = service; }
    public Order Submit(Order input)
    {
        return service.Create(input);
    }
}`,
  },
  {
    path: 'domain/OrderService.cs',
    content: `using Orders.Data;
using Orders.Events;
namespace Orders.Domain;
public class OrderService
{
    private OrderRepository repository;
    private EventPublisher events;
    public OrderService(OrderRepository repository, EventPublisher events)
    {
        this.repository = repository;
        this.events = events;
    }
    public Order Create(Order order)
    {
        Validate(order);
        repository.Save(order);
        events.Publish(order.Id);
        return order;
    }
    private void Validate(Order order)
    {
        if (order.Total <= 0) throw new System.ArgumentException("Total must be positive");
    }
}`,
  },
  {
    path: 'domain/Order.cs',
    content: `namespace Orders.Domain;
public class Order
{
    public string Id { get; set; }
    public decimal Total { get; set; }
}`,
  },
  {
    path: 'data/OrderRepository.cs',
    content: `using Orders.Domain;
namespace Orders.Data;
public class OrderRepository
{
    private Connection connection;
    public OrderRepository(Connection connection) { this.connection = connection; }
    public void Save(Order order)
    {
        connection.Execute("insert into orders values (@id, @total)", order);
    }
}`,
  },
  {
    path: 'data/Connection.cs',
    content: `namespace Orders.Data;
public class Connection
{
    public void Execute(string sql, object parameters)
    {
        // Sample adapter: no real database is contacted.
    }
}`,
  },
  {
    path: 'events/EventPublisher.cs',
    content: `namespace Orders.Events;
public class EventPublisher
{
    public void Publish(string orderId)
    {
        System.Console.WriteLine(orderId);
    }
}`,
  },
  {
    path: 'jobs/main.py',
    content: `from .extract import read_orders
from .transform import summarize
from .store import save_report

def run_report():
    orders = read_orders()
    report = summarize(orders)
    save_report(report)
    return report
`,
  },
  {
    path: 'jobs/extract.py',
    content: `import csv

def read_orders():
    with open("orders.csv", newline="") as source:
        return list(csv.DictReader(source))
`,
  },
  {
    path: 'jobs/transform.py',
    content: `from decimal import Decimal

def summarize(orders):
    total = sum(Decimal(order["total"]) for order in orders)
    return {"count": len(orders), "total": str(total)}
`,
  },
  {
    path: 'jobs/store.py',
    content: `import json

def save_report(report):
    with open("report.json", "w") as output:
        json.dump(report, output)
`,
  },
  {
    path: 'desktop/w_orders.srw',
    content: `$PBExportHeader$w_orders.srw
global type w_orders from w_base
end type

type variables
n_order_service inv_service
end variables

event open;
inv_service = create n_order_service
dw_orders.DataObject = "d_orders"
end event

event ue_save;
inv_service.of_save()
end event
`,
  },
  {
    path: 'desktop/w_base.srw',
    content: `$PBExportHeader$w_base.srw
global type w_base from window
end type

event open;
this.title = "Order workspace"
end event
`,
  },
  {
    path: 'desktop/n_order_service.sru',
    content: `$PBExportHeader$n_order_service.sru
global type n_order_service from nonvisualobject
end type

forward prototypes
public function integer of_save ()
end prototypes

public function integer of_save ();
return of_validate()
end function

private function integer of_validate ();
return 1
end function
`,
  },
  {
    path: 'desktop/d_orders.srd',
    content: `$PBExportHeader$d_orders.srd
release 19;
datawindow(units=0 color=1073741824)
table(column=(type=char(32) name=order_id dbname="orders.id") retrieve="SELECT id, total FROM orders")
`,
  },
  {
    path: 'README.md',
    content:
      '# Order platform example\n\nThree illustrative codebases: a C# order API, Python reporting jobs, and a PowerBuilder desktop client. Each is mapped from its own source. Cross-language service calls are not inferred. No real payments, database operations, or network calls are made by this example.',
  },
];
