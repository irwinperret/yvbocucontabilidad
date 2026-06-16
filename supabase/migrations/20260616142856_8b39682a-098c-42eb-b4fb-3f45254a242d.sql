UPDATE plan_de_cuentas SET codigo='12.4', grupo='Impuestos', orden=1204, afecta_gyp=false, afecta_fc=true, nombre='IVA débito fiscal cobrado' WHERE codigo='1.9';
UPDATE plan_de_cuentas SET codigo='12.5', grupo='Impuestos', orden=1205, afecta_gyp=false, afecta_fc=true, nombre='IVA crédito fiscal pagado' WHERE codigo='2.3';
UPDATE transacciones SET cuenta_codigo='12.4' WHERE cuenta_codigo='1.9';
UPDATE transacciones SET cuenta_codigo='12.5' WHERE cuenta_codigo='2.3';
UPDATE plan_de_cuentas SET grupo='Otros', orden=1101 WHERE codigo='11.1';
UPDATE plan_de_cuentas SET activa=false WHERE codigo='11.2';