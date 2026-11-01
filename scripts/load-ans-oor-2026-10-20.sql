-- One-off load: ANS On Order Report 10/20/26 (MAGNA_OOR_10.20.26.xlsx).
--
-- This file name didn't match the email ingest's filename filter, so it was
-- never auto-ingested. Run AFTER scripts/migrate-ans-item-base-match.sql
-- (the report's item codes, e.g. F4283S-1 / F4337S-1-10L, need the base-code
-- match). Writes bronze only; the trigger updates expected ship dates on the
-- matched PO lines (draft/ordered/confirmed). Re-running is a no-op.
-- The final SELECT shows every report row with its before/after ship date.

begin;

create temp table oor (customer_po text, ans_item_number text, est_ship_date date,
                       customer_req_date date, qty_ordered numeric, notes text, raw_payload jsonb)
  on commit drop;

insert into oor values
  ('10022', 'F4066S-1', '2026-11-29'::date, '2026-11-02'::date, 200000, 'Longest LT- R6516 Cucumber R6586 Lime Due 10/29/26 (increased demand)
Film Due: 11/4/26 (Shipping 10/30/26)

9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)', '{"soNumber":"SO572766","ansItemNumber":"F4066S-1","description":"Magna Hydration Watermelon Lime 1ct stick","salesQty":200000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":"2026-11-29","notes":"Longest LT- R6516 Cucumber R6586 Lime Due 10/29/26 (increased demand)\nFilm Due: 11/4/26 (Shipping 10/30/26)\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)"}'::jsonb),
  ('10022', 'F4283S-1', '2026-12-13'::date, '2026-11-02'::date, 300000, 'Longest LT- R6720 Strawberry Due 11/9/26 (increased demand)
Film Due: 11/4/26 (Shipping 10/30/26)

9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)', '{"soNumber":"SO572766","ansItemNumber":"F4283S-1","description":"Magna Hydration Blue Ice 1ct","salesQty":300000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":"2026-12-13","notes":"Longest LT- R6720 Strawberry Due 11/9/26 (increased demand)\nFilm Due: 11/4/26 (Shipping 10/30/26)\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)"}'::jsonb),
  ('10022', 'F4227S-1', '2026-12-06'::date, '2026-11-02'::date, 200000, 'Longest LT - R715 Mag ACC Due 11/2/26
Film Due: 11/4/26 (Shipping 10/30/26)

9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)', '{"soNumber":"SO572766","ansItemNumber":"F4227S-1","description":"Magna Hydration Island Punch 1ct","salesQty":200000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":"2026-12-06","notes":"Longest LT - R715 Mag ACC Due 11/2/26\nFilm Due: 11/4/26 (Shipping 10/30/26)\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)"}'::jsonb),
  ('10022', 'F4384S-1', '2026-11-22'::date, '2026-11-02'::date, 200000, 'ALL RM''s Released 
Film Due: 11/4/26 (Shipping 10/30/26)

 Team working to expedite shipping


9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)

NO NSF Cert', '{"soNumber":"SO572766","ansItemNumber":"F4384S-1","description":"MAGNA Hydration Shirley Temple 1ct","salesQty":200000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":"2026-11-22","notes":"ALL RM''s Released \nFilm Due: 11/4/26 (Shipping 10/30/26)\n\n Team working to expedite shipping\n\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)\n\nNO NSF Cert"}'::jsonb),
  ('10022', 'F4273S-1', '2026-12-14'::date, '2026-11-02'::date, 100000, 'Longest LT- R715 Mag ACC R35247 Reb A Due 11/2/26
Film Due: 11/4/26 (Shipping 10/30/26

9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)
*NO NSF Cert* 

 REFORM- Not approved

Keeping formula/artwork this run', '{"soNumber":"SO572766","ansItemNumber":"F4273S-1","description":"Magna Hydration Peach Tea 1ct","salesQty":100000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":"2026-12-14","notes":"Longest LT- R715 Mag ACC R35247 Reb A Due 11/2/26\nFilm Due: 11/4/26 (Shipping 10/30/26\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)\n*NO NSF Cert* \n\n REFORM- Not approved\n\nKeeping formula/artwork this run"}'::jsonb),
  ('10022', 'F4125S-1', null::date, '2026-11-02'::date, 100000, 'Longest LT- R715 Mag ACC Due 11/2/26

Film Due: HOLD
Pending NSF Approval - Submitted 9/25/26

9/22/26 Magna chose to not switch to surface printed. 
(10L- Sodium Update)

 REFORM-', '{"soNumber":"SO572766","ansItemNumber":"F4125S-1","description":"Magna Hydration Apple Juice 1ct","salesQty":100000,"customerPo":"10022","disposition":"QAHOLD","customerReqShipDate":"2026-11-02","estShipReadyDate":null,"notes":"Longest LT- R715 Mag ACC Due 11/2/26\n\nFilm Due: HOLD\nPending NSF Approval - Submitted 9/25/26\n\n9/22/26 Magna chose to not switch to surface printed. \n(10L- Sodium Update)\n\n REFORM-"}'::jsonb),
  ('10026', 'F4066S-1', '2026-11-22'::date, '2026-11-23'::date, 250000, 'Last RM R6017 Di Mag Due 10/19/26
Film Due: 11/4/26

9/22/26 Magna chose to not switch to surface printed.
Target 10ct FG- In Set Up', '{"soNumber":"SO573027","ansItemNumber":"F4066S-1","description":"Magna Hydration Watermelon Lime 1ct stick","salesQty":250000,"customerPo":"10026","disposition":"QAHOLD","customerReqShipDate":"2026-11-23","estShipReadyDate":"2026-11-22","notes":"Last RM R6017 Di Mag Due 10/19/26\nFilm Due: 11/4/26\n\n9/22/26 Magna chose to not switch to surface printed.\nTarget 10ct FG- In Set Up"}'::jsonb),
  ('10026', 'F4283S-1', '2026-11-22'::date, '2026-11-23'::date, 250000, 'Longest LT RM R4064 Spirulina Due 10/29/26
Film Due: 11/4/26

9/22/26 Magna chose to not switch to surface printed.
Target 10ct FG- In Set Up', '{"soNumber":"SO573027","ansItemNumber":"F4283S-1","description":"Magna Hydration Blue Ice 1ct","salesQty":250000,"customerPo":"10026","disposition":"QAHOLD","customerReqShipDate":"2026-11-23","estShipReadyDate":"2026-11-22","notes":"Longest LT RM R4064 Spirulina Due 10/29/26\nFilm Due: 11/4/26\n\n9/22/26 Magna chose to not switch to surface printed.\nTarget 10ct FG- In Set Up"}'::jsonb),
  ('10026', 'F4125S-1', null::date, '2026-11-23'::date, 200000, 'Longest LT R6610 Apple Type F Due 11/16/26 (R6607 Apple WONF Due 11/6/26) (Qty Adjustment)

Film Due: Hold 
Pending NSF Approval - Submitted 9/25/26 

 REFORM-  
9/22/26 Magna chose to not switch to surface printed.
Target 10ct FG- In Set Up', '{"soNumber":"SO573027","ansItemNumber":"F4125S-1","description":"Magna Hydration Apple Juice 1ct","salesQty":200000,"customerPo":"10026","disposition":"QAHOLD","customerReqShipDate":"2026-11-23","estShipReadyDate":null,"notes":"Longest LT R6610 Apple Type F Due 11/16/26 (R6607 Apple WONF Due 11/6/26) (Qty Adjustment)\n\nFilm Due: Hold \nPending NSF Approval - Submitted 9/25/26 \n\n REFORM-  \n9/22/26 Magna chose to not switch to surface printed.\nTarget 10ct FG- In Set Up"}'::jsonb),
  ('10026', 'F4227S-1', '2026-12-06'::date, '2026-11-23'::date, 250000, 'Longest LT- R715 Mag ACC Due 11/2/26
Film Due: 11/4/26

9/22/26 Magna chose to not switch to surface printed.
Target 10ct FG- In Set Up', '{"soNumber":"SO573027","ansItemNumber":"F4227S-1","description":"Magna Hydration Island Punch 1ct","salesQty":250000,"customerPo":"10026","disposition":"QAHOLD","customerReqShipDate":"2026-11-23","estShipReadyDate":"2026-12-06","notes":"Longest LT- R715 Mag ACC Due 11/2/26\nFilm Due: 11/4/26\n\n9/22/26 Magna chose to not switch to surface printed.\nTarget 10ct FG- In Set Up"}'::jsonb),
  ('10026', 'F4064S-1', '2026-11-22'::date, '2026-11-23'::date, 200000, 'Longest LT-R6096 Nat Lemonade Due 10/30/26 (R6354 Tea Due 10/21/26)

Film Due: 11/4/26
9/22/26 Magna chose to not switch to surface printed.', '{"soNumber":"SO573027","ansItemNumber":"F4064S-1","description":"Magna Hydration Tea + Lemonade 1ct stick","salesQty":200000,"customerPo":"10026","disposition":"QAHOLD","customerReqShipDate":"2026-11-23","estShipReadyDate":"2026-11-22","notes":"Longest LT-R6096 Nat Lemonade Due 10/30/26 (R6354 Tea Due 10/21/26)\n\nFilm Due: 11/4/26\n9/22/26 Magna chose to not switch to surface printed."}'::jsonb),
  ('10031', 'F4337S-1-10L', null::date, '2026-12-15'::date, 450000, 'Longest LT- Flavors Due 11/6/26
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4337S-1-10L","description":"Magna Hydration Tea Lemonade + Creatine 1ct","salesQty":450000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- Flavors Due 11/6/26\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4336S-1-10L', null::date, '2026-12-15'::date, 550000, 'Longest LT- R6856 Raspberry Due 11/18/26
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4336S-1-10L","description":"Magna Hydration Raspberry Lemonade + Creatine 1ct","salesQty":550000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- R6856 Raspberry Due 11/18/26\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4335S-1-10L', null::date, '2026-12-15'::date, 600000, 'Longest LT- R6776 Passionfruit Due 11/6/26
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4335S-1-10L","description":"Magna Hydration Passionfruit + Creatine 1ct","salesQty":600000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- R6776 Passionfruit Due 11/6/26\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4283S-1', null::date, '2026-12-15'::date, 150000, 'Longest LT- R5851 Orange Due 11/16/26 
(R6720 Strawberry Due 11/9/26)
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4283S-1","description":"Magna Hydration Blue Ice 1ct","salesQty":150000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- R5851 Orange Due 11/16/26 \n(R6720 Strawberry Due 11/9/26)\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4334S-1', null::date, '2026-12-15'::date, 150000, 'Longest LT - R6856 Rasp Due 11/9/26 (R6353 Black Tea R6354 Tea Due 11/6/26)
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4334S-1","description":"Magna Hydration Raspberry Tea 1ct","salesQty":150000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT - R6856 Rasp Due 11/9/26 (R6353 Black Tea R6354 Tea Due 11/6/26)\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4384S-1', null::date, '2026-12-15'::date, 150000, 'Multiple RM''s Due 11/4/26
R6236 Mag Gluconate - ETA TBD
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4384S-1","description":"MAGNA Hydration Shirley Temple 1ct","salesQty":150000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Multiple RM''s Due 11/4/26\nR6236 Mag Gluconate - ETA TBD\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4066S-1', null::date, '2026-12-15'::date, 300000, 'Longest LT R6586 Lime Due 11/18/26 (R6516 Cucumber Due 11/16/26)
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4066S-1","description":"Magna Hydration Watermelon Lime 1ct stick","salesQty":300000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT R6586 Lime Due 11/18/26 (R6516 Cucumber Due 11/16/26)\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4064S-1', null::date, '2026-12-15'::date, 400000, 'Longest LT- R6353 Black Tea R6354 Tea Due 11/6/26 (R6096 Lemonade Due 11/4/26)
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4064S-1","description":"Magna Hydration Tea + Lemonade 1ct stick","salesQty":400000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- R6353 Black Tea R6354 Tea Due 11/6/26 (R6096 Lemonade Due 11/4/26)\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4125S-1', null::date, '2026-12-15'::date, 200000, 'Longest LT- R6610 Apple Type F Due 11/16/26
(R6607 Apple WONF Due 11/6/26)

Film Due - HOLD Pending NSF Approval

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4125S-1","description":"Magna Hydration Apple Juice 1ct","salesQty":200000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT- R6610 Apple Type F Due 11/16/26\n(R6607 Apple WONF Due 11/6/26)\n\nFilm Due - HOLD Pending NSF Approval\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10031', 'F4227S-1', null::date, '2026-12-15'::date, 200000, 'Longest LT R3408 Nat Punch Due 11/4/26
Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573222","ansItemNumber":"F4227S-1","description":"Magna Hydration Island Punch 1ct","salesQty":200000,"customerPo":"10031","disposition":"QAHOLD","customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"Longest LT R3408 Nat Punch Due 11/4/26\nFilm Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4336S-1-10L', '2027-02-08'::date, '2027-02-08'::date, 600000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4336S-1-10L","description":"Magna Hydration Raspberry Lemonade + Creatine 1ct","salesQty":600000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4335S-1-10L', '2027-02-08'::date, '2027-02-08'::date, 500000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4335S-1-10L","description":"Magna Hydration Passionfruit + Creatine 1ct","salesQty":500000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4337S-1-10L', '2027-02-08'::date, '2027-02-08'::date, 450000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4337S-1-10L","description":"Magna Hydration Tea Lemonade + Creatine 1ct","salesQty":450000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4273S-1', '2027-02-08'::date, '2027-02-08'::date, 200000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4273S-1","description":"Magna Hydration Peach Tea 1ct","salesQty":200000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4384S-1', '2027-02-08'::date, '2027-02-08'::date, 500000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4384S-1","description":"MAGNA Hydration Shirley Temple 1ct","salesQty":500000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4064S-1', '2027-02-08'::date, '2027-02-08'::date, 300000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4064S-1","description":"Magna Hydration Tea + Lemonade 1ct stick","salesQty":300000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4227S-1', '2027-02-08'::date, '2027-02-08'::date, 400000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4227S-1","description":"Magna Hydration Island Punch 1ct","salesQty":400000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4125S-1', '2027-02-08'::date, '2027-02-08'::date, 400000, 'Film Due - HOLD- Pending NSF Approval

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4125S-1","description":"Magna Hydration Apple Juice 1ct","salesQty":400000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - HOLD- Pending NSF Approval\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4283S-1', '2027-02-08'::date, '2027-02-08'::date, 350000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4283S-1","description":"Magna Hydration Blue Ice 1ct","salesQty":350000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10032', 'F4066S-1', '2027-02-08'::date, '2027-02-08'::date, 250000, 'Film Due - Pending Vendor Confirmation

New PO- Teams working through MAT delivery dates', '{"soNumber":"SO573223","ansItemNumber":"F4066S-1","description":"Magna Hydration Watermelon Lime 1ct stick","salesQty":250000,"customerPo":"10032","disposition":"QAHOLD","customerReqShipDate":"2027-02-08","estShipReadyDate":"2027-02-08","notes":"Film Due - Pending Vendor Confirmation\n\nNew PO- Teams working through MAT delivery dates"}'::jsonb),
  ('10033', 'F4446S-1', null::date, '2026-12-15'::date, 100000, 'New Launch PO- Inside LT 
Film artwork Due 10/6/26 (10wks)

 ~ Tang flavor must be approved prior to set up~  
(RD Revision requested 10.19.26)', '{"soNumber":"SO573417","ansItemNumber":"F4446S-1","description":"Magna Hydration + Creatine Sun 1ct","salesQty":100000,"customerPo":"10033","disposition":null,"customerReqShipDate":"2026-12-15","estShipReadyDate":null,"notes":"New Launch PO- Inside LT \nFilm artwork Due 10/6/26 (10wks)\n\n ~ Tang flavor must be approved prior to set up~  \n(RD Revision requested 10.19.26)"}'::jsonb);

create temp table oor_match on commit drop as
select o.customer_po, o.ans_item_number, o.est_ship_date,
       (select pl.id
          from orchard.purchase_orders po
          join orchard.po_lines pl on pl.po_id = po.id
          join org_config.items i on i.id = pl.item_id
         where po.po_number = 'PO-' || o.customer_po
           and orchard.ans_item_base(i.ans_item_number) = orchard.ans_item_base(o.ans_item_number)
         order by (i.ans_item_number = o.ans_item_number) desc
         limit 1) as po_line_id
from oor o;

create temp table oor_before on commit drop as
select m.*, s.status as status_before, s.expected_ship_date as ship_before
from oor_match m
left join orchard_calcs.po_line_statuses s on s.po_line_id = m.po_line_id;

insert into orchard.ans_on_order_reports
  (client_id, report_date, report_received_at, source_filename, customer_po, ans_item_number,
   est_ship_date, customer_req_date, qty_ordered, qty_cancelled, notes, raw_payload)
select 'magna', date '2026-10-20', now(), 'MAGNA_OOR_10.20.26.xlsx', customer_po, ans_item_number,
       est_ship_date, customer_req_date, qty_ordered, null, notes, raw_payload
from oor
on conflict (client_id, report_date, customer_po, ans_item_number) do nothing;

select b.customer_po, b.ans_item_number,
       case when b.po_line_id is null then 'UNMATCHED' else 'matched' end as match,
       b.status_before, s.status as status_after,
       b.ship_before, s.expected_ship_date as ship_after
from oor_before b
left join orchard_calcs.po_line_statuses s on s.po_line_id = b.po_line_id
order by b.customer_po, b.ans_item_number;

commit;
